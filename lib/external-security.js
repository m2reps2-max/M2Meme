'use strict';

const ENDPOINT='https://gl1tchbased.xyz/api/scan';
const MAX_PER_MINUTE=30;
const CACHE_OK_MS=30*60*1000;
const CACHE_ERROR_MS=5*60*1000;
let requestTimes=[];
const inFlight=new Map();

function textValue(value,max=500){
  if(typeof value==='string')return value.trim().slice(0,max);
  if(typeof value==='number'||typeof value==='boolean')return String(value);
  return '';
}
function normalizeGL1TCHReport(input){
  const root=input?.report||input?.result||input?.data||input||{};
  const checks=Array.isArray(root.checks)?root.checks.slice(0,40).map((item,index)=>({
    name:textValue(item?.name||item?.title||item?.label||item?.id||('Contrôle '+(index+1)),100),
    status:textValue(item?.status||item?.verdict||item?.result||item?.level,60),
    severity:textValue(item?.severity||item?.risk,40),
    details:textValue(item?.reason||item?.message||item?.description||item?.details,500)
  })):[]; 
  const score=Number(root.score);
  const report={
    score:Number.isFinite(score)?Math.max(0,Math.min(100,score)):null,
    verdict:textValue(root.verdict||root.risk||root.status,80),
    confidence:textValue(root.confidence,80),
    bottomLine:textValue(root.bottomLine||root.summary||root.message,700),
    checks
  };
  return report.score!==null||report.verdict||report.bottomLine||checks.length?report:null;
}

async function inspectExternalSecurity(token){
  if(!token?.mint)throw new Error('Adresse du token absente');
  const now=Date.now();
  const previous=token.externalSecurity;
  const age=previous?.checkedAt?now-Date.parse(previous.checkedAt):Infinity;
  if(previous&&age<(previous.status==='ok'?CACHE_OK_MS:CACHE_ERROR_MS))return previous;
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
      const body=await response.text();
      let data;try{data=body?JSON.parse(body):{};}catch{throw new Error('Réponse GL1TCH non JSON');}
      if(!response.ok)throw new Error('GL1TCH HTTP '+response.status);
      const report=normalizeGL1TCHReport(data);
      if(!report)throw new Error('Format de rapport GL1TCH non reconnu');
      token.externalSecurity={status:'ok',provider:'GL1TCH · API publique gratuite',checkedAt:new Date().toISOString(),url:'https://gl1tchbased.xyz/scan/solana-'+token.mint,...report};
    }catch(error){
      token.externalSecurity={status:'unavailable',provider:'GL1TCH · API publique gratuite',checkedAt:new Date().toISOString(),error:String(error?.message||error).slice(0,180)};
    }finally{
      inFlight.delete(token.mint);
    }
    return token.externalSecurity;
  })();
  inFlight.set(token.mint,task);
  return task;
}

module.exports={inspectExternalSecurity,normalizeGL1TCHReport};
