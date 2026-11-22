# MEME RADAR — version gratuite

Dashboard privé de recherche de meme coins Solana. Le projet utilise uniquement des sources publiques gratuites : DexScreener et le RPC public Solana. Telegram est facultatif. Aucun fournisseur payant, aucune clé API payante, aucun wallet de trading et aucune signature de transaction.

## Fonctions disponibles sans payer

| Fonction | Source | Configuration |
|---|---|---|
| Découverte de tokens | DexScreener (profils récents et tokens boostés) + PumpPortal (créations Pump.fun et migrations en direct) | Rien |
| Prix, liquidité, volume, transactions, âge de la paire | DexScreener | Rien |
| Momentum acheteurs/vendeurs, pression 5 min et divergences prix/volume | DexScreener + historique local | Rien |
| Qualité de liquidité, ratio volume/liquidité, FDV/liquidité | DexScreener + historique local | Rien |
| Drapeaux de risque : pression vendeuse, chute de liquidité, pool très peu liquide | DexScreener + RPC public | Rien |
| Contrôles de mint/freeze authority | RPC public Solana | Rien |
| Deuxième avis de sécurité (wallets liés, volume artificiel, historique du déployeur, risques Token-2022, liquidité) | GL1TCH public API, sans clé | Rien |
| Concentration des 10 plus gros détenteurs, avec agrégation des comptes appartenant au même wallet (sur les 20 plus gros comptes renvoyés) | RPC public Solana (`getMultipleAccounts`) | Rien |
| Suivi de 10 wallets maximum | RPC public Solana, 5 transactions récentes par wallet, toutes les 10 minutes | Rien |
| Liens de sites et réseaux sociaux | Métadonnées DexScreener | Rien |
| Alertes Telegram | Telegram Bot API | Bot token + chat ID facultatifs |
| Dashboard et historique | Express + stockage JSON local | Variables d'accès + stockage persistant FadeHost |

**Limites importantes :**
- DexScreener ne recense pas instantanément tous les tokens créés sur Solana. Le flux PumpPortal ajoute les créations et migrations Pump.fun en direct, mais ne couvre pas tous les launchpads ni tous les DEX, et ne garantit pas la réception de chaque événement de création même sur Pump.fun. Un événement de migration peut parfois permettre de récupérer un token après coup, sans reconstituer sa date de création ni son créateur.
- Le RPC public Solana est partagé et soumis à des limites de débit. Si FadeHost ou d'autres utilisateurs envoient trop de requêtes, certaines vérifications peuvent échouer temporairement. On peut renseigner un autre endpoint RPC public/gratuit dans `SOLANA_RPC_URL`, sans garantie de disponibilité.
- Les contrôles on-chain donnent des observations : ils ne prouvent pas que la liquidité est verrouillée, qu'un token est vendable ou qu'un contrat est sûr.
- La concentration des détenteurs agrège les comptes SPL par wallet propriétaire sur les 20 plus gros comptes renvoyés par le RPC, puis calcule top 1 / top 5 / top 10 wallets. La concentration brute des 10 comptes est également affichée. C'est plus fiable qu'un simple classement de comptes, mais ce n'est pas une cartographie complète des bénéficiaires : les wallets liés entre eux ne sont pas fusionnés, et les comptes de pool ou de contrats peuvent apparaître dans le classement.
- Le suivi détaillé des transactions et du comportement des wallets reste limité aux adresses ajoutées manuellement. La performance affichée compare le comportement du token après un achat observé; ce n'est pas le PnL réel du wallet. Les clusters ne concernent que les wallets surveillés et ne prouvent pas qu'ils sont liés.
- Aucun compteur de mentions X, d'engagement ou de tendance sociale n'est disponible gratuitement de façon suffisamment fiable. Le tableau des narratifs est une classification locale par mots-clés des noms/symboles des tokens récemment lancés, pas une mesure de popularité.
- L'analyse des détenteurs utilise uniquement les 20 plus gros comptes renvoyés par le RPC public. Elle ne détecte pas les liens indirects entre wallets (même personne, financement commun, bundles) et ne doit pas être interprétée comme une preuve d'identité. Les liens sociaux publics restent visibles.
- Les scores sont des indicateurs heuristiques, pas des probabilités de hausse ni des conseils d'achat. Les signaux de momentum et les variations de liquidité ne deviennent exploitables qu'après plusieurs observations espacées; au premier scan, l'historique est incomplet.
- Les mesures de volume/liquidité et FDV/liquidité sont des ratios descriptifs, pas des preuves de liquidité réellement retirable. Les données DexScreener peuvent être retardées ou incomplètes.
- Les bundles, snipers et liens de financement entre wallets ne sont pas prouvés automatiquement. Les flux PumpPortal de créations/migrations sont gratuits; ses flux détaillés d'achats/ventes sont payants et ne sont volontairement pas activés. Les signaux de concentration et de pression vendeuse sont des heuristiques, pas des preuves de manipulation.

## Détection précoce et microstructure

MEME RADAR ouvre désormais une connexion WebSocket unique à PumpPortal et s'abonne uniquement aux flux `subscribeNewToken` et `subscribeMigration`, indiqués comme gratuits par la documentation PumpPortal. Les créations enregistrent le mint, le nom, le symbole, le wallet créateur observé, l'horodatage, l'achat initial en quantité de tokens (pas en SOL), la market cap en SOL et les réserves de bonding curve normalisées lorsque la source les fournit. Les migrations sont attachées au même token; un token dont seul l'événement de migration a été reçu est également conservé, avec son heure de détection plutôt qu'une fausse date de création. En cas de coupure, reconnexion avec temporisation exponentielle. Les tokens nouvellement découverts sont automatiquement ajoutés aux recherches DexScreener suivantes pour récupérer leur marché dès qu'une paire est indexée.

Le score de momentum intègre aussi les transactions, le ratio acheteurs/vendeurs, le volume relatif et la variation de prix sur cinq minutes quand DexScreener fournit ces champs. Des alertes dédiées signalent la pression vendeuse, les pics de volume sur faible liquidité, les divergences prix/volume et les chutes rapides. Les drapeaux critiques empêchent l'envoi d'une alerte d'opportunité. Les alertes sont classées en trois niveaux : « À surveiller » (premiers signaux), « Opportunité » (score et liquidité suffisants) et « Danger » (drapeau critique ou blocage de sécurité). Les alertes de surveillance restent dans le dashboard; les opportunités et dangers peuvent aussi être envoyés sur Telegram.

**Limites et coût :** la création et la migration PumpPortal sont annoncées gratuites. Les flux de trades par token ou par compte sont payants (0,01 SOL par 10 000 événements selon la documentation actuelle) et ne sont pas utilisés. Les données PumpPortal sont limitées à son écosystème; ce n'est pas un flux universel de toutes les créations Solana. Documentation : [PumpPortal Real-time Data](https://pumpportal.fun/data-api/real-time/).

## Intelligence créateur, wallets et narratifs

- Les créations Pump.fun fournissent un wallet créateur observé; MEME RADAR regroupe les tokens par cette adresse et compare leurs prévisions résolues à 1h. Pour les anciens tokens, l'autorité mint/freeze reste seulement un proxy.
- Pour les wallets suivis manuellement, les achats peuvent être rapprochés des prévisions ultérieures du token. Le rendement affiché est un indicateur de ce qui est arrivé au token après l'achat, pas un PnL réalisé du wallet.
- Les achats rapprochés par au moins trois wallets surveillés sont signalés comme cluster d'activité. Cela ne prouve pas que ces adresses appartiennent à la même personne ou participent à un bundle.
- Les narratifs sont classés localement à partir de mots-clés dans les noms, symboles et descriptions des tokens découverts sur 1h/24h. Aucune mention X, audience, sentiment ou engagement n'est collecté.

## Prévisions et faux signaux

Les prévisions conservent désormais les excursions maximales favorables et défavorables observées pendant leur suivi, en plus du rendement au point de résolution. Le tableau Résultats affiche aussi, parmi les signaux avec score d'au moins 65, la part qui a subi une forte perte ou une forte baisse de liquidité à 1h. Ce chiffre est un proxy de faux signaux risqués; il ne constitue pas une preuve qu'un token a fait rug pull. Les résultats ne sont pas des performances de trading exécuté.

## Deuxième avis de sécurité gratuit (GL1TCH)

Automatiquement, MEME RADAR demande aussi un rapport indépendant à l'API publique de GL1TCH pour les cinq candidats prioritaires du contrôle de sécurité, environ toutes les dix minutes, et à l'ouverture d'une fiche token si le rapport est absent ou périmé. Aucun abonnement ni clé API n'est requis. Le rapport peut apporter des signaux complémentaires sur les wallets liés, les volumes artificiels, l'historique du déployeur, les extensions Token-2022, les métadonnées et la liquidité. Le score et le verdict GL1TCH sont affichés séparément : ils ne sont pas mélangés au score MEME RADAR, car les échelles et méthodes des deux projets ne sont pas nécessairement comparables.

Le résultat est mis en cache 30 minutes en cas de succès et 5 minutes en cas d'échec. MEME RADAR plafonne ses propres appels à 30 par minute pour rester sous la limite publique annoncée par GL1TCH (40/minute par IP). Le module est facultatif du point de vue du fonctionnement : si GL1TCH est indisponible, le scanner local continue normalement. Aucun nouveau secret, abonnement ou variable FadeHost n'est requis.

**Limites :** il s'agit d'un service tiers gratuit, soumis à sa disponibilité, à ses quotas et à ses conditions qui peuvent évoluer. Le rapport n'est pas une garantie et ne remplace pas les vérifications locales. Source et licence du projet : [GL1TCH (MIT)](https://github.com/gl1tchbased-pixel/gl1tch-coin).

## Modules d'intelligence

- **Analyse créateur (proxy)** : regroupe les tokens par mint/freeze authority exposée par les contrôles RPC. Ce n'est pas une identification certaine du créateur initial.
- **Wallet intelligence** : observe les variations nettes de soldes SPL dans les transactions récentes des wallets ajoutés. Les prix au moment exact de chaque transaction, le PnL net, les frais et le slippage ne sont pas certifiés.
- **Backtesting** : compare le prix d'un snapshot au premier snapshot disponible après 1, 5, 15 et 30 minutes, puis segmente les résultats selon le score initial. Les résultats s'accumulent à partir du déploiement et n'incluent ni frais, ni slippage, ni tokens jamais découverts.

## Benchmark historique des anciens gagnants

Le module de backtesting propose un replay exploratoire sur BONK, WIF, POPCAT, BOME, MEW, TRUMP, PENGU, FARTCOIN, PNUT, MOODENG, GOAT, GIGA, PONKE, CHILLGUY, WEN, MYRO, SAMO, SLERF, VINE, MELANIA, USELESS, ZEREBRO, LIBRA, HAWK, CAR, JELLYJELLY, ACT, BERT, MANEKI, MOTHER, UFD et BELIEVE via GeckoTerminal Public API. Les nouveaux tokens sont résolus par recherche de pools, puis leur pool le plus liquide est sélectionné. Les cohortes couvrent gagnants de cycle, tokens à forte volatilité, phases de boom/bust, corrections et longues traînes; ces étiquettes décrivent des familles de cas à tester, pas une affirmation que chaque token est un rug ou un échec. Il récupère le pool le plus liquide indexé puis jusqu'à 180 bougies journalières. Le score historique est un **proxy** basé sur le volume relatif des 7 jours précédents et le momentum de prix sur 3/7 jours : il ne peut pas reconstruire les transactions acheteurs/vendeurs, la liquidité historique, les détenteurs, les autorités de sécurité ni les wallets smart money. Il ne reproduit donc pas exactement le score live.

La fenêtre OHLCV publique est limitée et les tokens plus anciens ne sont pas rejoués depuis leur lancement; le benchmark étudie uniquement la période renvoyée par la source. Comme la liste contient des gagnants connus, elle mesure la capacité à repérer des hausses chez des survivants, pas la précision sur l'ensemble des tokens perdants. Données source : [GeckoTerminal Public API](https://api.geckoterminal.com/docs/index.html), environ 10 appels/minute; le dashboard collecte les tokens progressivement.

## Apprentissage continu des prévisions\n\nToutes les 15 minutes, pour les pools suivis avec au moins 1 000 USD de liquidité, MEME RADAR enregistre une prévision immuable (score, couverture, classification, risque, liquidité, volume et prix), puis la compare automatiquement à la première observation disponible après 15 minutes, 1 heure, 6 heures, 24 heures et 7 jours. Il calcule les rendements, variations de liquidité et taux de gagnants/perdants par horizon et par tranche de score. Les résultats restent attachés aux prévisions et sont persistés dans `data/store.json`; ils survivent donc aux redémarrages si le stockage FadeHost est persistant.\n\nLe système fournit une calibration et une tranche de score historiquement la plus prometteuse seulement à partir d'au moins 30 observations résolues à 1 heure. **Il ne modifie pas automatiquement les poids ni les seuils du scanner** : les mesures live ne suffisent pas encore pour éviter le surapprentissage. Il faudra ensuite comparer ces recommandations sur une période de validation qui n'a pas servi à les établir. Une observation manquante ou un scanner arrêté peut empêcher la résolution d'un horizon.\n\n## Installation sur FadeHost

1. Connecte le dépôt GitHub ou mets à jour les fichiers de l'application.
2. Choisis **Node.js 20 ou supérieur**.
3. Dans le panneau FadeHost, configure les variables listées ci-dessous.
4. Lance l'installation des dépendances avec `npm install`.
5. Définis la commande de démarrage sur `npm start`.
6. Vérifie que le dossier `data/` est conservé lors des redémarrages et redéploiements.

## Variables FadeHost à configurer

### Obligatoires
- `DASHBOARD_ACCESS_CODE` : ton code privé, sans longueur minimale ; il doit simplement être non vide. Pour la sécurité, évite un code trop facile à deviner.
- `DASHBOARD_SESSION_SECRET` : secret aléatoire stable d'au moins 32 caractères. Ne le change pas à chaque redémarrage.
- `DASHBOARD_URL` : URL HTTPS publique du dashboard.
- `NODE_ENV` : `production`.

Génère une valeur forte pour le secret de session avec cette commande sur une machine disposant de Node.js :
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
Ne partage jamais ces secrets dans une conversation et ne les commits pas sur GitHub.

### Facultatives
- `BOT_TOKEN` : token obtenu auprès de @BotFather si tu veux le bot Telegram.
- `TELEGRAM_CHAT_ID` : identifiant du chat ou canal destinataire. Le bot doit avoir accès au chat.
- `SOLANA_RPC_URL` : endpoint RPC Solana alternatif. Si vide, le projet utilise automatiquement `https://api.mainnet.solana.com`.
- `PORT` : laisse la valeur attendue par FadeHost (souvent injectée automatiquement).
- `SCAN_INTERVAL_MS` : intervalle du scanner, par défaut 60000 (60 secondes).
- `ALERT_MIN_SCORE` : score minimal d'alerte, par défaut 78.
- `MIN_LIQUIDITY_USD` : liquidité minimale, par défaut 5000 USD.

**Aucune autre clé n'est nécessaire.** N'ajoute pas `BIRDEYE_API_KEY`, `HELIUS_API_KEY`, `X_BEARER_TOKEN` ou `PUMPPORTAL_API_KEY` : cette version ne les utilise plus.

## Telegram

Commandes : `/start`, `/dashboard`, `/scan`, `/opportunities`, `/help`. Les alertes sont envoyées uniquement si `BOT_TOKEN` et `TELEGRAM_CHAT_ID` sont renseignés.

## Sécurité et données

- Aucun achat/vente automatique, aucune clé privée et aucune signature de transaction.
- Le code d'accès est vérifié côté serveur.
- La session utilise un cookie HttpOnly signé, avec une durée navigateur de 10 ans. Le navigateur peut toujours supprimer ses cookies.
- Les sessions persistent au redémarrage si `DASHBOARD_SESSION_SECRET` reste identique.
- Le scanner crée `data/store.json` automatiquement, écrit de façon atomique et conserve une copie `data/store.json.bak` du dernier état valide. En cas de fichier principal illisible au redémarrage, la copie est utilisée automatiquement. Le dossier `data/` doit être persistant sur FadeHost.
- Les variables secrètes doivent rester dans le panneau FadeHost, jamais dans le dépôt GitHub.
