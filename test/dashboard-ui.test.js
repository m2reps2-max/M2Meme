'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/dashboard.html'),'utf8');
const js=fs.readFileSync(path.join(root,'public/dashboard.js'),'utf8');
const selection=fs.readFileSync(path.join(root,'lib/selection.js'),'utf8');

test('main dashboard navigation has only four simple sections',()=>{
 const nav=html.match(/<nav id="nav"[\s\S]*?<\/nav>/)?.[0]||'';
 const views=[...nav.matchAll(/data-view="([^"]+)"/g)].map(x=>x[1]);
 assert.deepEqual(views,['overview','scanner','watchlist','more']);
 assert.match(nav,/Accueil/);
 assert.match(nav,/Sélection/);
 assert.match(nav,/Favoris/);
 assert.match(nav,/Plus/);
});

test('Plus menu exposes only results, alerts and settings',()=>{
 const start=js.indexOf('function renderMore(){');
 const end=js.indexOf('\nfunction renderSettings(){',start);
 assert.ok(start>=0&&end>start);
 const source=js.slice(start,end);
 const destinations=[...source.matchAll(/\['(backtest|alerts|settings)'/g)].map(x=>x[1]);
 assert.deepEqual(destinations,['backtest','alerts','settings']);
 assert.doesNotMatch(source,/walletGraph|smartIntel|creators|historical|quality|social/);
});

test('home shows only essential stats and keeps advanced modules out of sight',()=>{
 const start=js.indexOf('function renderOverview(){');
 const end=js.indexOf('\nfunction renderScanner',start);
 assert.ok(start>=0&&end>start);
 const source=js.slice(start,end);
 assert.match(source,/Sélectionnés/);
 assert.match(source,/Favoris/);
 assert.match(source,/À surveiller/);
 assert.doesNotMatch(source,/sourceCards\(\)|Nouveaux lancements|Graphe wallets|Qualité des données|Wallets suivis/);
});

test('advanced intelligence pages remain available internally and scanner navigation is preserved',()=>{
 for(const name of ['renderDetail','renderWalletIntel','renderCreators','renderWalletGraph','renderQuality','renderHistorical'])assert.match(js,new RegExp('function '+name+'\\('));
 assert.ok(js.includes("scanner:()=>renderScanner('scanner')"));
 assert.match(js,/analysis:renderDetail/);
});

test('wallet reputation page exposes point-in-time backtest and outcomes against a baseline',()=>{
 const start=js.indexOf('function renderExperts(){');
 const end=js.indexOf('\nfunction renderMore(){',start);
 const source=js.slice(start,end);
 assert.match(source,/backtestPanel/);
 assert.match(source,/averageReturnPct/);
 assert.match(source,/Helius/);
 assert.match(js,/api\/intelligence\/wallet-signal-backtest/);
});

test('Radar shortlist is capped at five best and five watch candidates with strict data gates',()=>{
 assert.match(selection,/\.slice\(0,5\)/);
 assert.ok(selection.includes('Number(t.analysis?.coverage||0)>=80'));
 assert.ok(selection.includes('Number(t.liquidityUsd||0)>=10000'));
 assert.match(selection,/risk!=='high'/);
 assert.match(js,/Aucun candidat assez solide/);
 assert.match(js,/pré-marchés à 5 % ne sont pas présentés comme des opportunités/);
});
test('scanner view no longer exposes the full token catalogue or coverage sort filters',()=>{
 const start=js.indexOf('function renderScanner(){');
 const end=js.indexOf('\nfunction refreshTable',start);
 const source=js.slice(start,end);
 assert.match(source,/Meilleurs candidats/);
 assert.match(source,/À surveiller/);
 assert.doesNotMatch(source,/filters\(\)|tokenTable\(/);
});

test('top candidates require complete holder evidence and fully checked security',()=>{
 assert.match(selection,/securityComprehensive===true/);
 assert.match(selection,/risk==='observations_only'/);
 assert.match(selection,/typeof value==='number'/);
 assert.match(selection,/risk!=='unknown'/);
});
test('candidate cards distinguish partial security evidence from verified security',()=>{
 assert.match(js,/Preuves partielles/);
 assert.match(js,/Risque moyen/);
 assert.match(js,/Sécurité vérifiée/);
});
test('dashboard assets share one cache version so deployed UI fixes are loaded together',()=>{
 const version=html.match(/dashboard\.js\?v=([^"]+)/)?.[1];
 assert.ok(version);
 assert.ok(html.includes('/assets/styles.css?v='+version));
 assert.ok(html.includes('/assets/live.css?v='+version));
});

test('dashboard loads a server-side shortlist instead of selecting from the first 200 score-sorted tokens',()=>{
 assert.match(js,/\['Sélection','\/api\/selection'\]/);
 assert.match(js,/if\(i===5\)state\.selection=data/);
 assert.match(js,/function selectionPools\(\)\{return state\.selection/);
});

test('results page displays prospective shortlist cohorts separately from generic forecasts',()=>{
 assert.match(js,/Qualité réelle de la Sélection/);
 assert.match(js,/Échantillon témoin/);
 assert.match(js,/api\/selection-performance/);
 assert.match(js,/selectionPerformance=data/);
});

test('HTML closing-tag helper is shared by all dashboard renderers',()=>{
 const declaration=js.indexOf('const closeTag=name=>');
 const candidate=js.indexOf('function candidateCards(');
 const overview=js.indexOf('function renderOverview(');
 const scanner=js.indexOf('function renderScanner(');
 assert.ok(declaration>=0&&declaration<candidate&&candidate<overview&&overview<scanner);
 assert.doesNotMatch(js.slice(candidate,overview),/const closeTag=name=>/);
 assert.match(js.slice(overview,scanner),/closeTag\('div'\)/);
 assert.match(js.slice(scanner,js.indexOf('function refreshTable')),/closeTag\('div'\)/);
});

test('every dashboard button action is connected to a delegated handler',()=>{
 for(const attr of ['data-token','data-watch','data-go','data-remove-wallet'])assert.ok(js.includes("hasAttribute('"+attr+"')"),attr);
 for(const id of ['refresh-tokens','retry-dashboard'])assert.ok(js.includes("target.id==='"+id+"'"),id);
 assert.ok(js.includes("view.addEventListener('submit'"));
 assert.ok(js.includes("$('#logout').addEventListener"));
 assert.ok(js.includes("nav.addEventListener('click'"));
});
test('dashboard actions provide pending state and report failures instead of silently failing',()=>{
 assert.ok(js.includes('async function runButtonAction('));
 assert.ok(js.includes('button.disabled=true'));
 assert.ok(js.includes("setAttribute('aria-busy','true')"));
 assert.ok(js.includes('Action impossible'));
 assert.ok(js.includes('async function removeWallet('));
 assert.ok(js.includes('async function toggleWatch('));
});
test('opening token details preserves the enriched token response without a full dashboard reload',()=>{
 const start=js.indexOf('async function openToken(');
 const end=js.indexOf('async function scan(',start);
 const source=js.slice(start,end);
 assert.ok(source.includes('state.selected=data.token'));
 assert.ok(!source.includes('await load('));
});
test('dashboard UI action endpoints exist on the server',()=>{
 const server=fs.readFileSync(path.join(root,'index.js'),'utf8');
 for(const route of ["app.post('/api/scan'","app.post('/api/watchlist'","app.delete('/api/watchlist/:mint'","app.post('/api/wallets'","app.delete('/api/wallets/:address'","app.get('/api/token/:mint'","app.post('/api/logout'"])assert.ok(server.includes(route),route);
});
