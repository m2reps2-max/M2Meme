'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/dashboard.html'),'utf8');
const js=fs.readFileSync(path.join(root,'public/dashboard.js'),'utf8');

test('main dashboard navigation has only four simple sections',()=>{
 const nav=html.match(/<nav id="nav"[\s\S]*?<\/nav>/)?.[0]||'';
 const views=[...nav.matchAll(/data-view="([^"]+)"/g)].map(x=>x[1]);
 assert.deepEqual(views,['overview','scanner','watchlist','more']);
 assert.match(nav,/Accueil/);
 assert.match(nav,/Scanner/);
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
 assert.match(source,/Tokens suivis/);
 assert.match(source,/Mes favoris/);
 assert.match(source,/Alertes/);
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
 assert.match(js,/\.slice\(0,5\)/);
 assert.match(js,/coverage\|\|0\)\)>=80/);
 assert.match(js,/liquidityUsd\|\|0\)\)>=10000/);
 assert.match(js,/analysis\?\.risk!=='high'/);
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
