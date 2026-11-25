'use strict';

const ENDPOINT='https://gl1tchbased.xyz/api/scan';
const MAX_PER_MINUTE=30;
const CACHE_OK_MS=30*60*1000;
const CACHE_ERROR_MS=5*60*1000;
let requestTimes=[];
const inFlight=new Map();
const { readJsonLimited } = require('./http-body');

function textValue(value,max=500){
  if(typeof value==='string')return value.trim().slice(0,max);
  if(typeof value==='number'||typeof value==='boolean')return String(value);
  return '';
}
function numberOrNull(value){
  if(value===null||value===undefined||value==='')return null;
  const number=Number(value);
  return Number.isFinite(number)?number:null;
}
function normalizeGL1TCHReport(input){
  const root=input?.report||input?.result||input?.data||input||{};
  const checks=Array.isArray(root.checks)?root.checks.slice(0,40).map((item,index)=>({
    name:textValue(item?.name||item?.title||item?.label||item?.id||('Contrôle '+(index+1)),100),
    status:textValue(item?.status||item?.verdict||item?.result||item?.level,60),
    severity:textValue(item?.severity||item?.risk,40),
    details:textValue(item?.reason||item?.message||item?.description||item?.details,500)
  })):[]; 
  const reasons=Array.isArray(root.reasons)?root.reasons.slice(0,20).map(x=>textValue(typeof x==='string'?x:x?.message||x?.reason||x?.title,240)).filter(Boolean):[];
  const score=numberOrNull(root.score),confidence=numberOrNull(root.confidence);
  const report={
    score:score===null?null:Math.max(0,Math.min(100,score)),
    verdict:textValue(root.verdict||root.risk||root.status,80).toUpperCase(),
    confidence:confidence===null?textValue(root.confidence,80):Math.max(0,Math.min(100,confidence)),
    bottomLine:textValue(root.bottomLine||root.summary||root.message,700),
    reasons,
    scannedAt:numberOrNull(root.scannedAt),
    checks
  };
  return report.score!==null||report.verdict||report.bottomLine||checks.length?report:null;
}
function assessExternalSecurity(externalSecurity){
  if(!externalSecurity||externalSecurity.status!=='ok'){
    return {decision:'inconclusive',reason:'Contrôle externe GL1TCH absent ou indisponible; aucune validation de sécurité ne peut être supposée.'};
  }
  const report=externalSecurity;
  const verdict=String(report.verdict||'').trim().toUpperCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
  const checks=Array.isArray(report.checks)?report.checks:[];
  const spamCheck=checks.find(check=>{
    const description=[check?.name,check?.details].filter(Boolean).join(' ');
    const state=[check?.status,check?.severity].filter(Boolean).join(' ').toLowerCase();
    if(!/\bspam\b/i.test(description)||/\b(no|not|false positive|aucun|pas de)\s+spam\b/i.test(description))return false;
    return /fail|warn|risk|flag|detect|block|critical|high|spam|bad/i.test(state)||!state;
  });
  if(spamCheck)return {decision:'block',reason:'GL1TCH signale explicitement un comportement spam : '+String(spamCheck.details||spamCheck.name).slice(0,180)};
  if(['HIGH RISK','RUG SHAPED'].includes(verdict))return {decision:'block',reason:'Verdict GL1TCH défavorable : '+verdict+'. '+String(report.bottomLine||'').slice(0,180)};
  if(verdict==='CAUTION')return {decision:'block',reason:'GL1TCH classe ce token en CAUTION; il ne peut pas entrer dans la sélection des meilleures opportunités.'};
  if(!['CLEAN','LOW RISK'].includes(verdict))return {decision:'inconclusive',reason:'Verdict GL1TCH non concluant ('+(verdict||'absent')+').'};
  const confidence=numberOrNull(report.confidence),score=numberOrNull(report.score);
  if(confidence===null||confidence<50||score===null||score<60)return {decision:'inconclusive',reason:'Rapport GL1TCH trop peu documenté pour valider la sécurité (confiance ou score insuffisant).'};
  return {decision:'clear',reason:'GL1TCH : '+verdict+' · confiance '+confidence+'/100.'};
}
async function inspectExternalSecurity(token){
  if(!token?.mint)throw new Error('Adresse du token absente');
  const now=Date.now(),previous=token.externalSecurity;
  const age=previous?.checkedAt?now-Date.parse(previous.checkedAt):Infinity;
  if(previous&&age<(previous.status==='ok'?CACHE_OK_MS:previous.status==='rate_limited'?60000:CACHE_ERROR_MS))return previous;
  if(inFlight.has(token.mint))return inFlight.get(token.mint);
  requestTimes=requestTimes.filter(at=>now-at<60000);
  if(requestTimes.length>=MAX_PER_MINUTE){
    token.externalSecurity={...(previous||{}),status:'rate_limited',provider:'GL1TCH · API publique gratuite',checkedAt:new Date(now).toISOString(),error:'Limite locale de sécurité atteinte; réessaie dans une minute.'};
    return token.externalSecurity;
  }
  requestTimes.push(now);
  const task=(async()=>{
    try{
      const url=ENDPOINT+'?mint='+encodeURIComponent(token.mint)+'&chain=solana';
      const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(9000)});
      let data;
      try{data=await readJsonLimited(response,256*1024);}
      catch(error){throw new Error('Réponse GL1TCH invalide ou trop volumineuse: '+String(error.message||error).slice(0,120));}
      if(!response.ok)throw new Error('GL1TCH HTTP '+response.status);
      const report=normalizeGL1TCHReport(data);
      if(!report)throw new Error('Format de rapport GL1TCH non reconnu');
      token.externalSecurity={status:'ok',provider:'GL1TCH · API publique gratuite',checkedAt:new Date().toISOString(),url:'https://gl1tchbased.xyz/scan/solana-'+token.mint,...report};
    }catch(error){
      token.externalSecurity={status:'unavailable',provider:'GL1TCH · API publique gratuite',checkedAt:new Date().toISOString(),error:String(error?.message||error).slice(0,180)};
    }finally{inFlight.delete(token.mint);}
    return token.externalSecurity;
  })();
  inFlight.set(token.mint,task);
  return task;
}
module.exports={inspectExternalSecurity,normalizeGL1TCHReport,assessExternalSecurity};
