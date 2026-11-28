'use strict';
const { readJsonLimited } = require('./http-body');
const { setBoundedCache } = require('./bounded-cache');
const MAX_SOCIAL_CACHE_ENTRIES = 400;

const { sentiment } = require('./social-radar');
const API_HOSTS=['https://api.bsky.app','https://public.api.bsky.app'];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

class BlueskyRadar {
  constructor({fetchImpl=fetch}={}) {
    this.fetchImpl=fetchImpl;
    this.cache=new Map();
    this.lastRequestAt=0;
    this.lastSuccessAt=null;
    this.lastError=null;
    this.refreshing=false;
  }
  queryFor(token) {
    const symbol=String(token?.symbol||'').replace(/^\$/,'').trim();
    if(!/^[a-z0-9]{3,15}$/i.test(symbol))return null;
    return '$'+symbol;
  }
  async searchToken(token) {
    const mint=String(token?.mint||'');
    const query=this.queryFor(token);
    if(!mint||!query)return {available:false,error:'Symbole insuffisant pour une recherche sociale fiable.'};
    const cached=this.cache.get(mint);
    if(cached&&Date.now()-Date.parse(cached.checkedAt)<1800000)return cached;
    const delay=Math.max(0,10000-(Date.now()-this.lastRequestAt));
    if(delay)await wait(delay);
    this.lastRequestAt=Date.now();
    try {
      let response=null,lastStatus=null;
      for(let index=0;index<API_HOSTS.length;index++){
        const url=API_HOSTS[index]+'/xrpc/app.bsky.feed.searchPosts?q='+encodeURIComponent(query)+'&sort=latest&limit=20';
        response=await this.fetchImpl(url,{headers:{accept:'application/json','user-agent':'MEME-RADAR/2.2 public social discovery'},signal:AbortSignal.timeout(12000)});
        if(response.ok)break;
        lastStatus=response.status;
        if(response.status!==403||index===API_HOSTS.length-1)throw new Error('Bluesky public search HTTP '+response.status);
      }
      if(!response?.ok)throw new Error('Bluesky public search HTTP '+lastStatus);
      const payload=await readJsonLimited(response,128*1024);
      const posts=(payload.posts||[]).map(row=>{
        const record=row.post?.record||{};
        const author=row.post?.author||{};
        const text=String(record.text||'').slice(0,2000);
        const createdAt=record.createdAt||row.post?.indexedAt||null;
        const uri=String(row.post?.uri||'');
        const handle=String(author.handle||'');
        const exactMention=new RegExp('(^|[^a-z0-9])\\$'+query.slice(1)+'([^a-z0-9]|$)','i').test(text);
        return {text,createdAt:createdAt&&Number.isFinite(Date.parse(createdAt))?new Date(createdAt).toISOString():null,author:handle,uri,likes:Number(row.post?.likeCount)||0,reposts:Number(row.post?.repostCount)||0,replies:Number(row.post?.replyCount)||0,exactMention};
      }).filter(x=>x.text&&x.createdAt&&x.exactMention);
      const now=Date.now();
      const recent1h=posts.filter(x=>now-Date.parse(x.createdAt)<=3600000);
      const recent24h=posts.filter(x=>now-Date.parse(x.createdAt)<=86400000);
      const authors=new Set(recent24h.map(x=>x.author).filter(Boolean));
      const scores=recent24h.map(x=>sentiment(x.text)).filter(x=>x.score!==null);
      const result={available:true,provider:'Bluesky public search',query,checkedAt:new Date().toISOString(),mentions1h:recent1h.length,mentions24h:recent24h.length,uniqueAuthors24h:authors.size,engagement24h:recent24h.reduce((sum,x)=>sum+x.likes+x.reposts+x.replies,0),sentimentScore:scores.length?Math.round(scores.reduce((sum,x)=>sum+x.score,0)/scores.length):null,posts:recent24h.slice(0,8).map(x=>({title:x.text.slice(0,240),link:x.uri?x.uri.replace('at://','https://bsky.app/profile/').replace('/app.bsky.feed.post/','/post/'):null,publishedAt:x.createdAt,source:'Bluesky',author:x.author,likes:x.likes,reposts:x.reposts,replies:x.replies}))};
      setBoundedCache(this.cache,mint,result,MAX_SOCIAL_CACHE_ENTRIES);
      this.lastSuccessAt=result.checkedAt;this.lastError=null;
      return result;
    } catch(error) {
      this.lastError=String(error.message||error).slice(0,180);
      const result={available:false,provider:'Bluesky public search',query,checkedAt:new Date().toISOString(),error:this.lastError,mentions1h:0,mentions24h:0,uniqueAuthors24h:0,engagement24h:0,sentimentScore:null,posts:[]};
      this.cache.set(mint,result);
      return result;
    }
  }
  status() {
    return {configured:true,connected:Boolean(this.lastSuccessAt),mode:'Bluesky public search · sans clé, api.bsky.app puis public.api.bsky.app si 403',lastSuccess:this.lastSuccessAt,lastError:this.lastError,cachedTokens:this.cache.size,cacheMinutes:30};
  }
}
module.exports={BlueskyRadar};
