'use strict';
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function historyRisk(token, now=Date.now()){
  const rows=(Array.isArray(token?.history)?token.history:[])
    .map(row=>({at:typeof row?.at==='number'?row.at:Date.parse(row?.at||''),price:numberOrNull(row?.priceUsd)}))
    .filter(row=>Number.isFinite(row.at)&&row.at<=now+60000&&row.price!==null&&row.price>0)
    .sort((a,b)=>a.at-b.at);
  const recent=rows.filter(row=>row.at>=now-30*60*1000);
  if(recent.length<3)return {sinceFirstObservedPct:null,drawdownFromRecentPeakPct:null,negativeSinceFirstObservation:false,severePeakDrawdown:false};
  const first=recent[0],last=recent.at(-1),peak=recent.reduce((value,row)=>Math.max(value,row.price),0);
  const spanMinutes=(last.at-first.at)/60000;
  const sinceFirstObservedPct=(last.price/first.price-1)*100;
  const drawdownFromRecentPeakPct=(last.price/peak-1)*100;
  return {sinceFirstObservedPct:Number(sinceFirstObservedPct.toFixed(2)),drawdownFromRecentPeakPct:Number(drawdownFromRecentPeakPct.toFixed(2)),negativeSinceFirstObservation:spanMinutes>=5&&sinceFirstObservedPct<=-20,severePeakDrawdown:spanMinutes>=5&&drawdownFromRecentPeakPct<=-25};
}
function evaluateMomentumRisk(token = {}) {
  const createdAt = [token.pairCreatedAt, token.geckoPoolCreatedAt, token.pumpCreatedAt, token.launchCreatedAt]
    .map(value => typeof value === 'number' ? value : Date.parse(value || ''))
    .find(value => Number.isFinite(value) && value > 0);
  const poolAgeMinutes = createdAt === undefined ? null : Math.max(0, (Date.now() - createdAt) / 60000);
  const change=token.priceChange||{},m5=numberOrNull(change.m5),h1=numberOrNull(change.h1),h24=numberOrNull(change.h24);
  const buys=numberOrNull(token.txns?.m5?.buys),sells=numberOrNull(token.txns?.m5?.sells);
  const total=(buys??0)+(sells??0),buyRatio=total>0?(buys??0)/total:null;
  const volume5m=numberOrNull(token.volume?.m5),volume1h=numberOrNull(token.volume?.h1);
  const relativeVolume5m=volume5m!==null&&volume1h!==null&&volume1h>0?volume5m/(volume1h/12):null;
  const flags=Array.isArray(token.analysis?.flags)?token.analysis.flags:[];
  const creatorOrEarlySales=flags.some(flag=>['CREATOR_SELL_OBSERVED','EARLY_WALLET_SELL_CLUSTER'].includes(String(flag?.code||'')));
  const extendedMove=(h1!==null&&h1>=80)||(h24!==null&&h24>=200);
  const verticalMove=(h1!==null&&h1>=300)||(h24!==null&&h24>=500);
  const lateLaunchVertical=poolAgeMinutes!==null&&poolAgeMinutes<=20&&h1!==null&&h1>=150;
  const earlyMomentum=m5!==null&&m5>=0&&m5<=15&&total>=8&&buyRatio!==null&&buyRatio>=0.58&&relativeVolume5m!==null&&relativeVolume5m>=1.15;
  const accelerationWithoutConfirmation=m5!==null&&m5>=18&&((relativeVolume5m!==null&&relativeVolume5m<1.2)||(buyRatio!==null&&buyRatio<0.55));
  const profitTakingPressure=total>=8&&sells!==null&&buys!==null&&sells>=Math.max(5,buys*1.4);
  const pullback=h1!==null&&h1>=15&&m5!==null&&m5<=-3;
  const exhaustion=(m5!==null&&m5<=-8&&profitTakingPressure)||(m5!==null&&m5<=-12&&relativeVolume5m!==null&&relativeVolume5m<0.6)||(creatorOrEarlySales&&profitTakingPressure&&m5!==null&&m5<0);
  const history=historyRisk(token);
  const verticalMoveUnconfirmed=verticalMove&&(m5===null||m5<=0||buyRatio===null||buyRatio<0.55||relativeVolume5m===null||relativeVolume5m<0.8);
  const historySelloff=history.negativeSinceFirstObservation||history.severePeakDrawdown;
  const acuteSelloff=m5!==null&&m5<=-18&&total>=10&&buys!==null&&sells!==null&&sells>=Math.max(8,buys*1.5);
  const blockPublication=acuteSelloff||verticalMoveUnconfirmed||historySelloff||lateLaunchVertical;
  let adjustment=0;
  if(earlyMomentum)adjustment+=7;
  if(extendedMove)adjustment-=3;
  if(accelerationWithoutConfirmation)adjustment-=8;
  if(profitTakingPressure)adjustment-=8;
  if(pullback)adjustment-=3;
  if(exhaustion)adjustment-=12;
  if(blockPublication)adjustment-=25;
  if(lateLaunchVertical)adjustment-=5;
  adjustment=Math.max(-30,Math.min(10,adjustment));
  const signals=[];
  if(earlyMomentum)signals.push('Début de mouvement soutenu par les achats et le volume');
  if(extendedMove)signals.push('Hausse déjà avancée : potentiel restant à confirmer');
  if(accelerationWithoutConfirmation)signals.push('Accélération du prix insuffisamment confirmée par le volume ou les acheteurs');
  if(profitTakingPressure)signals.push('Pression de prises de bénéfices : les ventes récentes dominent');
  if(pullback)signals.push('Repli après une hausse : attendre de voir si les acheteurs reviennent');
  if(exhaustion)signals.push('Signes d’essoufflement détectés');
  if(lateLaunchVertical)signals.push('Hausse d’au moins 150 % sur une heure dans un pool de moins de 20 minutes : risque élevé d’entrée tardive, publication bloquée');
  if(verticalMoveUnconfirmed)signals.push('Hausse verticale sans confirmation récente par le prix, les acheteurs et le volume : publication bloquée');
  if(history.negativeSinceFirstObservation)signals.push('Prix en baisse de 20 % ou plus depuis le début des observations : publication bloquée');
  if(history.severePeakDrawdown)signals.push('Repli de 25 % ou plus depuis le sommet observé récemment : publication bloquée');
  if(acuteSelloff)signals.push('Vente brutale confirmée sur les dernières minutes : publication suspendue');
  if(!signals.length)signals.push('Pas de signal de momentum suffisamment documenté');
  const status=acuteSelloff||historySelloff?'selloff':lateLaunchVertical?'late_launch_vertical':verticalMoveUnconfirmed?'unconfirmed_vertical_move':exhaustion?'exhaustion':profitTakingPressure?'profit_taking':pullback?'pullback':accelerationWithoutConfirmation?'unconfirmed_acceleration':extendedMove?'extended':earlyMomentum?'early_momentum':'neutral';
  return {status,adjustment,blockPublication,metrics:{priceChange5mPct:m5,priceChange1hPct:h1,priceChange24hPct:h24,buys5m:buys,sells5m:sells,buyRatio5mPct:buyRatio===null?null:Number((buyRatio*100).toFixed(1)),relativeVolume5m:relativeVolume5m===null?null:Number(relativeVolume5m.toFixed(2)),sinceFirstObservedPct:history.sinceFirstObservedPct,drawdownFromRecentPeakPct:history.drawdownFromRecentPeakPct},detectors:{earlyMomentum,extendedMove,verticalMove,lateLaunchVertical,verticalMoveUnconfirmed,accelerationWithoutConfirmation,profitTakingPressure,exhaustion,pullback,negativeSinceFirstObservation:history.negativeSinceFirstObservation,severePeakDrawdown:history.severePeakDrawdown},signals};
}
module.exports={evaluateMomentumRisk,historyRisk};
