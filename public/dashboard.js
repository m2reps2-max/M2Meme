'use strict';
const view = document.querySelector('#view');
const title = document.querySelector('#page-title');
const nav = document.querySelector('#nav');
const labels = { overview:'Vue générale', scanner:'Live Scanner', opportunities:'Opportunités', smart:'Smart Money', security:'Sécurité', social:'Social Intelligence', alerts:'Alertes & historique', settings:'Paramètres' };
const empty = (name,desc) => `<section class="panel empty-panel"><div class="empty-icon">⌁</div><span class="eyebrow">MODULE À CONNECTER</span><h2>${name}</h2><p>${desc}</p><span class="pill warn">Pas encore actif</span></section>`;
const render = key => {
  title.textContent = labels[key] || labels.overview;
  nav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.view === key));
  if (key === 'overview') view.innerHTML = `
    <div class="welcome"><div><p class="eyebrow">EARLY SIGNALS · BETTER DECISIONS</p><h2>Repère les projets <em>avant le bruit.</em></h2><p>Un centre de recherche pour détecter, comparer et surveiller les nouveaux meme coins.</p></div><div class="orb">◎</div></div>
    <div class="stat-grid"><article class="stat panel"><span>Tokens surveillés</span><strong>—</strong><small>En attente de source de données</small></article><article class="stat panel"><span>Signaux détectés</span><strong>—</strong><small>Scanner non connecté</small></article><article class="stat panel"><span>Opportunités actives</span><strong>—</strong><small>Aucune donnée inventée</small></article><article class="stat panel"><span>Alertes aujourd'hui</span><strong>—</strong><small>Alertes non configurées</small></article></div>
    <div class="section-heading"><div><p class="eyebrow">WORKSPACE</p><h2>Centre de contrôle</h2></div><span class="pill neutral">Configuration initiale</span></div>
    <div class="module-grid"><button class="module panel" data-go="scanner"><span class="module-icon">⌕</span><b>Live Scanner</b><small>Détection précoce et activité on-chain</small><span class="module-state">À connecter →</span></button><button class="module panel" data-go="smart"><span class="module-icon">⌘</span><b>Smart Money</b><small>Suivi des portefeuilles pertinents</small><span class="module-state">À connecter →</span></button><button class="module panel" data-go="security"><span class="module-icon">⬡</span><b>Security Checks</b><small>Liquidité, permissions et risques</small><span class="module-state">À connecter →</span></button><button class="module panel" data-go="social"><span class="module-icon">◎</span><b>Social Intelligence</b><small>Accélération sociale et narratifs</small><span class="module-state">À connecter →</span></button></div>
    <div class="notice"><b>Important</b><p>MEME RADAR V1 est la base sécurisée du dashboard. Aucun flux blockchain ou social n'est encore branché : les données réelles apparaîtront après l'intégration des fournisseurs.</p></div>`;
  else if (key === 'scanner') view.innerHTML = empty('Live Scanner','Le scanner multi-critères sera connecté aux flux de nouveaux tokens, liquidité, volume, acheteurs uniques et croissance des holders.');
  else if (key === 'opportunities') view.innerHTML = empty('Opportunités','Les candidats seront classés selon leur potentiel, leur liquidité, leur traction et leur niveau de risque. Aucun score fictif ne sera affiché.');
  else if (key === 'smart') view.innerHTML = empty('Smart Money','Suivi des wallets, historique des performances, clusters et flux entrants à intégrer.');
  else if (key === 'security') view.innerHTML = empty('Sécurité des tokens','Contrôles de contrat, permissions, liquidité, concentration des holders, bundles et risques de rug pull à intégrer.');
  else if (key === 'social') view.innerHTML = empty('Social Intelligence','Détection des narratifs, croissance des mentions et accélération communautaire à intégrer.');
  else if (key === 'alerts') view.innerHTML = empty('Alertes & historique','Les signaux détectés, décisions et alertes seront conservés ici une fois les sources connectées.');
  else if (key === 'settings') view.innerHTML = `<section class="panel settings"><p class="eyebrow">CONFIGURATION</p><h2>Paramètres du workspace</h2><div class="setting-row"><div><b>Accès partagé</b><p>Le code d'accès se modifie dans les variables d'environnement FadeHost.</p></div><span class="pill good">Actif</span></div><div class="setting-row"><div><b>Session persistante</b><p>Cookie signé, HttpOnly, sans expiration côté serveur. Le navigateur peut toujours supprimer ses cookies.</p></div><span class="pill good">Actif</span></div><div class="setting-row"><div><b>Sources de données</b><p>Aucune blockchain, API sociale ou source de wallet n'est encore configurée.</p></div><span class="pill warn">À connecter</span></div><div class="setting-row"><div><b>Trading automatique</b><p>Désactivé. MEME RADAR est un outil de recherche uniquement.</p></div><span class="pill neutral">Désactivé</span></div></section>`;
};
nav.addEventListener('click', e => { const b=e.target.closest('[data-view]'); if(b) render(b.dataset.view); });
view.addEventListener('click', e => { const b=e.target.closest('[data-go]'); if(b) render(b.dataset.go); });
document.querySelector('#logout').addEventListener('click', async () => { await fetch('/api/logout',{method:'POST'}); location.replace('/login'); });
fetch('/api/me').then(r => { if(!r.ok) location.replace('/login'); }).catch(() => location.replace('/login'));
fetch('/api/status').then(r=>r.json()).then(s=>{ if(!s.ok) throw new Error('status'); }).catch(()=>{});
render('overview');