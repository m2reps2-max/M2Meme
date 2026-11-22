'use strict';

const THEMES=[
 ['IA / agents',/\b(ai|agent|gpt|llm|neural|robot|bot|artificial|claude)\b/i],
 ['Animaux',/\b(cat|dog|doge|pepe|frog|monkey|penguin|bear|bull|shark|bird|hamster)\b/i],
 ['Politique',/\b(trump|maga|biden|president|politic|election|government)\b/i],
 ['Culture internet',/\b(meme|wojak|chill|sigma|brainrot|viral|tiktok|internet| pepe)\b/i],
 ['Finance / trading',/\b(gold|silver|stock|coin|finance|bank|trader|market|quant)\b/i],
 ['Gaming',/\b(game|gaming|gamer|minecraft|fortnite|pokemon|sonic|mario)\b/i]
];

function narrativeSummary(tokens, now=Date.now()){
 const counts=new Map();
 for(const token of tokens){
  const at=Date.parse(token.firstSeenAt||token.pumpCreatedAt||token.updatedAt||0);
  if(!Number.isFinite(at)||now-at>86400000)continue;
  const text=[token.name,token.symbol,token.description].filter(Boolean).join(' ');
  for(const [theme,pattern] of THEMES)if(pattern.test(text)){
   const row=counts.get(theme)||{theme,tokens1h:0,tokens24h:0,samples:[]};
   row.tokens24h++;
   if(now-at<=3600000)row.tokens1h++;
   if(row.samples.length<5)row.samples.push({symbol:token.symbol||'—',name:token.name||'Token'});
   counts.set(theme,row);
  }
 }
 return [...counts.values()].sort((a,b)=>b.tokens1h-a.tokens1h||b.tokens24h-a.tokens24h).slice(0,8);
}

module.exports={narrativeSummary};
