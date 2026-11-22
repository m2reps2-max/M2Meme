# MEME RADAR — version gratuite

Dashboard privé de recherche de meme coins Solana. Le projet utilise des sources publiques gratuites : DexScreener, GeckoTerminal, Reddit RSS, Bluesky public search, PumpPortal (créations/migrations) et le RPC public Solana. Telegram est facultatif. Aucun fournisseur payant, aucune clé API payante, aucun wallet de trading et aucune signature de transaction.

## Fonctions disponibles sans payer

| Fonction | Source | Configuration |
|---|---|---|
| Découverte de tokens | DexScreener + GeckoTerminal (nouveaux pools Solana multi-DEX) + PumpPortal (créations Pump.fun et migrations en direct) | Rien |
| Prix, liquidité, volume, transactions, âge de la paire | DexScreener | Rien |
| Momentum acheteurs/vendeurs, pression 5 min et divergences prix/volume | DexScreener + historique local | Rien |
| Qualité de liquidité, ratio volume/liquidité, FDV/liquidité | DexScreener + historique local | Rien |
| Drapeaux de risque : pression vendeuse, chute de liquidité, pool très peu liquide | DexScreener + RPC public | Rien |
| Contrôles de mint/freeze authority | RPC public Solana | Rien |
| Deuxième avis de sécurité (wallets liés, volume artificiel, historique du déployeur, risques Token-2022, liquidité) | GL1TCH public API, sans clé | Rien |
| Concentration des 10 plus gros détenteurs, avec agrégation des comptes appartenant au même wallet (sur les 20 plus gros comptes renvoyés) | RPC public Solana (`getMultipleAccounts`) | Rien |
| Recherche du premier financeur direct des wallets créateurs Pump.fun et détection de financeurs communs | RPC public Solana (`getSignaturesForAddress`, `getTransaction`) | Rien |
| Suivi des wallets manuels, acheteurs précoces et créateurs Pump.fun observés | RPC public Solana : pagination persistante par curseur, jusqu’à 20 signatures par wallet et par cycle de surveillance de 10 minutes | Rien |
| Surveillance des sorties des créateurs | Soldes SPL avant/après transaction + entrées SOL/USDC/USDT dans la même transaction | Rien |
| Distinction vente probable / transfert | Sortie du token accompagnée d’une entrée de quote asset = swap-like; sortie seule = mouvement non confirmé | Rien |
| Découverte automatique d'acheteurs précoces | Acheteurs ayant réalisé au moins 2 achats et 150 USD cumulés dans les 5 premières minutes du pool, uniquement si cette fenêtre est entièrement couverte et si le token a un score indicatif ≥60 et aucun blocage de risque critique | Rien |
| Surveillance des acheteurs découverts | Jusqu'à 5 wallets automatiques, 3 transactions récentes chacun toutes les 10 minutes | Rien |
| Liens de sites et réseaux sociaux | Métadonnées DexScreener | Rien |
| Découverte de nouveaux pools sur plusieurs DEX Solana | GeckoTerminal Public API (`/networks/solana/new_pools`) | Rien |
| Mentions et sentiment communautaire indicatif | Flux RSS Reddit + recherche publique Bluesky + relais Nostr NIP-50, sans clé | Rien |
| Analyse des transactions récentes, diversité acheteurs, concentration, bursts 5 secondes et clusters same-block de type bundle | GeckoTerminal pool trades (jusqu'à 300 transactions observées), persistées dans l'historique wallet avec source et déduplication par signature | Rien |
| Graphe des wallets | Financeurs communs des créateurs observés et achats rapprochés répétés sur plusieurs tokens; niveaux de preuve distincts | Rien |
| Ajustement limité du score avec qualité des transactions et signal social public | Module local candidate-intel, GeckoTerminal + Reddit + Bluesky | Rien |
| Calibration hors échantillon | Walk-forward chronologique par mint : premiers 80% des signaux en entraînement, 20% les plus récents en validation, avec comparaison à une base aléatoire et au taux global | Rien |
| Cohorte prospective sans filtre de liquidité minimum | Tous les tokens découverts avec premier prix observable, y compris pools très faibles et absence de marché après 30 min | Rien |
| Qualité des données | Complétude et fraîcheur par token, catégories manquantes et échantillons disponibles | Rien |
| Continuité RPC Solana | Endpoint configuré en priorité, puis bascule automatique vers deux RPC publics alternatifs avec cooldown par fournisseur | Rien |
| Cohortes historiques gagnants / survivants / boom-bust | Bougies publiques GeckoTerminal, replay proxy journalier, rendements fixes à 1j/3j/7j après chaque signal, rendement final et drawdown | Rien |
| Enrichissement automatique du meilleur candidat GeckoTerminal et d'un créateur observé à la fois | Quotas publics maîtrisés, une analyse de pool par cycle et un financement créateur toutes les 15 minutes au maximum | Rien |
| Alertes Telegram | Telegram Bot API | Bot token + chat ID facultatifs |
| Dashboard et historique | Express + stockage JSON local | Variables d'accès + stockage persistant FadeHost |

**Limites importantes :**
- GeckoTerminal ajoute les nouveaux pools indexés sur plusieurs DEX Solana (jusqu'à 40 pools sur deux pages publiques et fenêtre récente), mais ne détecte pas les tokens encore sur une bonding curve sans pool. PumpPortal ajoute les créations/migrations Pump.fun. Raydium LaunchLab, Meteora DBC, Moonshot, LetsBonk et autres launchpads ne sont donc visibles qu'après qu'un pool est indexé par GeckoTerminal ou DexScreener, pas au moment exact de leur création.
- Le RPC public Solana est partagé et soumis à des limites de débit. Si FadeHost ou d'autres utilisateurs envoient trop de requêtes, certaines vérifications peuvent échouer temporairement. On peut renseigner un autre endpoint RPC public/gratuit dans `SOLANA_RPC_URL`, sans garantie de disponibilité.
- Les contrôles on-chain donnent des observations : ils ne prouvent pas que la liquidité est verrouillée, qu'un token est vendable ou qu'un contrat est sûr.
- La concentration des détenteurs agrège les comptes SPL par wallet propriétaire sur les 20 plus gros comptes renvoyés par le RPC, puis calcule top 1 / top 5 / top 10 wallets. La concentration brute des 10 comptes est également affichée. C'est plus fiable qu'un simple classement de comptes, mais ce n'est pas une cartographie complète des bénéficiaires : les wallets liés entre eux ne sont pas fusionnés, et les comptes de pool ou de contrats peuvent apparaître dans le classement.
- Le suivi des wallets combine jusqu'à 10 adresses manuelles, 5 acheteurs précoces découverts automatiquement et 5 wallets créateurs observés dans les événements Pump.fun. Les acheteurs automatiques sont des candidats à observer, pas des wallets réputés rentables. La performance affichée compare un snapshot de prix proche de l'achat observé à un snapshot disponible environ une heure après; si ces observations manquent, le résultat n'est pas compté. Ce n'est pas le PnL réel du wallet. Les clusters ne concernent que les wallets surveillés et ne prouvent pas qu'ils sont liés. Les transactions d'un wallet créateur sont surveillées : une baisse de solde du token accompagnée d'une entrée SOL/USDC/USDT dans la même transaction est classée « swap-like »; une baisse sans quote asset entrant est seulement une sortie de tokens non confirmée (transfert, burn ou autre). Les données de soldes ne prouvent pas à elles seules l'intention économique.
- Le module social lit trois flux RSS publics Reddit et interroge aussi la recherche publique Bluesky sans clé, à raison de deux tokens prioritaires maximum par cycle de cinq minutes et avec cache de 30 minutes. Bluesky est interrogé par cashtag exact; les symboles courts/ambigus sont ignorés. Les deux hôtes peuvent refuser la recherche, auquel cas le statut l'indique sans inventer de mentions. Le signal combine mentions, auteurs et sentiment lexical rudimentaire, mais ne mesure pas une audience fiable et ne couvre pas X ni Telegram. Les sources peuvent limiter les requêtes; leurs erreurs n'empêchent pas le scanner de fonctionner. Le tableau des narratifs reste une classification locale par mots-clés.
- L'analyse des détenteurs utilise uniquement les 20 plus gros comptes renvoyés par le RPC public. Elle ne détecte pas les liens indirects entre wallets (même personne, financement commun, bundles) et ne doit pas être interprétée comme une preuve d'identité. Les liens sociaux publics restent visibles.
- Les scores sont des indicateurs heuristiques, pas des probabilités de hausse ni des conseils d'achat. Les signaux de momentum et les variations de liquidité ne deviennent exploitables qu'après plusieurs observations espacées; au premier scan, l'historique est incomplet.
- Les mesures de volume/liquidité et FDV/liquidité sont des ratios descriptifs, pas des preuves de liquidité réellement retirable. Les données DexScreener peuvent être retardées ou incomplètes.
- Les bundles, snipers et liens de financement entre wallets ne sont pas prouvés automatiquement. Les flux PumpPortal de créations/migrations sont gratuits; ses flux détaillés d'achats/ventes sont payants et ne sont volontairement pas activés. Les signaux de concentration et de pression vendeuse sont des heuristiques, pas des preuves de manipulation.

## Scoring enrichi et collecte automatique

Le score principal conserve ses facteurs de marché, de momentum, de liquidité, de sécurité, de wallets suivis et de timing. Un ajustement complémentaire plafonné à +/- 6 points utilise uniquement les données réellement disponibles : qualité de l'échantillon de transactions GeckoTerminal et signal social public Reddit/Bluesky. Ces sous-scores ne gonflent pas le pourcentage de couverture des données. En l'absence de données, aucun facteur n'est inventé. La fiche token expose le score de base, l'ajustement et les raisons observées.

Le scanner enrichit automatiquement un pool GeckoTerminal candidat par cycle, en respectant un espacement d'au moins 15 secondes entre les appels de transactions, et examine au maximum un financement de créateur observé toutes les 15 minutes. Ces vérifications restent limitées par les quotas RPC/API publics et peuvent être indisponibles. Un même bloc ou un financeur commun est un indice à examiner, jamais une preuve de manipulation ou d'identité commune.

## Découverte multi-DEX gratuite

À chaque cycle de scan, MEME RADAR interroge aussi `https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1&include=base_token,quote_token,dex`. Les pools détectés sont ajoutés à la file de tokens, avec le DEX, l'heure de création, la liquidité, le prix, le volume et les transactions fournis par GeckoTerminal. Les données sont ensuite enrichies par DexScreener dès qu'une paire est disponible. La source publique GeckoTerminal est sans clé, mais limitée à environ 10 appels/minute et ses réponses sont mises en cache; le scanner ne fait qu'un appel par cycle.

## Social Radar gratuit

Le module `RedditRadar` interroge périodiquement les flux RSS publics de `r/solana`, `r/memecoins` et `r/pumpfun`. `BlueskyRadar` utilise l'endpoint public `app.bsky.feed.searchPosts` sans authentification et traite jusqu'à cinq candidats par cycle. `NostrRadar` interroge un relais public NIP-50 (`relay.nostr.band`) pour un candidat supplémentaire par cycle, sans clé; les événements sont filtrés localement par symbole ou nom exact, dédupliqués et limités aux dernières 24 heures. Les résultats exposent mentions 1h/24h, auteurs et sentiment lexical; l'engagement visible n'est fourni que par Bluesky. Le nombre de tokens couverts est volontairement limité pour respecter les endpoints publics. Aucun accès X/Twitter ou Telegram n'est revendiqué. La recherche Nostr dépend du support NIP-50 et de la disponibilité du relais public; un échec est affiché comme source indisponible et n'interrompt pas le scanner.

Sur la fiche d'un token dont le pool est connu de GeckoTerminal, MEME RADAR charge les transactions publiques récentes (jusqu'à 300) et calcule acheteurs/vendeurs distincts, concentration des cinq principaux acheteurs, clusters d'au moins trois acheteurs dans le même bloc, rafales de cinq secondes et, si la couverture le permet, acheteurs des cinq premières minutes du pool. Cette analyse est déclenchée à l'ouverture de la fiche, mise en cache cinq minutes et espacée pour respecter les quotas publics. Les clusters same-block et rafales sont des signaux « bundle-like »; ils ne prouvent ni bundle, ni sniper, ni identité commune, ni manipulation. Ils sont exposés avec les adresses et volumes observés pour audit.

## Détection précoce et microstructure

MEME RADAR ouvre désormais une connexion WebSocket unique à PumpPortal et s'abonne uniquement aux flux `subscribeNewToken` et `subscribeMigration`, indiqués comme gratuits par la documentation PumpPortal. Les créations enregistrent le mint, le nom, le symbole, le wallet créateur observé, l'horodatage, l'achat initial en quantité de tokens (pas en SOL), la market cap en SOL et les réserves de bonding curve normalisées lorsque la source les fournit. Les migrations sont attachées au même token; un token dont seul l'événement de migration a été reçu est également conservé, avec son heure de détection plutôt qu'une fausse date de création. En cas de coupure, reconnexion avec temporisation exponentielle. Les tokens nouvellement découverts sont automatiquement ajoutés aux recherches DexScreener suivantes pour récupérer leur marché dès qu'une paire est indexée.

Le score de momentum intègre aussi les transactions, le ratio acheteurs/vendeurs, le volume relatif et la variation de prix sur cinq minutes quand DexScreener fournit ces champs. Des alertes dédiées signalent la pression vendeuse, les pics de volume sur faible liquidité, les divergences prix/volume et les chutes rapides. Les drapeaux critiques empêchent l'envoi d'une alerte d'opportunité. Les alertes sont classées en trois niveaux : « À surveiller » (premiers signaux), « Opportunité » (score et liquidité suffisants) et « Danger » (drapeau critique ou blocage de sécurité). Une opportunité ou un danger exige un snapshot marché de moins de 5 minutes; entre 5 et 15 minutes, le signal est rétrogradé en « À surveiller » et n'est pas envoyé sur Telegram; au-delà de 15 minutes ou sans horodatage, l'alerte est supprimée. Les alertes de surveillance restent dans le dashboard; seules les opportunités et dangers suffisamment frais peuvent aussi être envoyés sur Telegram.

**Limites et coût :** la création et la migration PumpPortal sont annoncées gratuites. Les flux de trades par token ou par compte sont payants (0,01 SOL par 10 000 événements selon la documentation actuelle) et ne sont pas utilisés. Les données PumpPortal sont limitées à son écosystème; ce n'est pas un flux universel de toutes les créations Solana. Documentation : [PumpPortal Real-time Data](https://pumpportal.fun/data-api/real-time/).

## Intelligence créateur, wallets et narratifs

- Les créations Pump.fun fournissent un wallet créateur observé; MEME RADAR regroupe les tokens par cette adresse, compare leurs prévisions résolues à 1h et recherche jusqu'à 10 transactions les plus anciennes parmi les 1 000 signatures accessibles pour identifier un transfert ou une création de compte qui l'a financé. Les créateurs partageant un financeur direct sont regroupés comme indice à vérifier. Le contrôle est limité à un créateur par cycle de sécurité (environ 10 minutes) pour respecter les quotas du RPC public. Si 1 000 signatures sont renvoyées, l'historique peut être tronqué et le premier financement réel peut être antérieur à l'échantillon. Une absence de transfert direct dans ces dix transactions ne prouve pas l'absence de financeur commun. Un financeur commun peut être un exchange ou un service et ne prouve aucune coordination. Pour les anciens tokens sans provenance de création, l'autorité mint/freeze reste seulement un proxy.
- Pour les wallets suivis manuellement, les acheteurs précoces et les créateurs Pump.fun surveillés, les achats peuvent être rapprochés des prévisions ultérieures du token. Le rendement affiché est un indicateur de ce qui est arrivé au token après l'achat, pas un PnL réalisé du wallet. Les sorties swap-like des acheteurs précoces sont aussi agrégées sur 30 minutes; une alerte « À surveiller » apparaît si au moins deux wallets distincts vendent et que les ventes représentent au moins 20% du volume d'achats swap-like observé pour ces wallets. Ce seuil porte sur l'échantillon local, pas sur l'ensemble des détenteurs.
- Le graphe relie les wallets créateurs ayant un financeur direct commun observé et les wallets qui répètent des achats rapprochés sur plusieurs tokens. Un même slot ou une seule proximité temporelle reste un signal faible; un financeur commun peut être un exchange ou un service. Les wallets non suivis et les transactions non récupérées par le RPC restent invisibles. Aucun lien ne prouve une identité ou un bundle.
- La page Qualité des données mesure la complétude (marché, historique, sécurité, transactions, social, provenance) et la fraîcheur des observations horodatées. Ces notes évaluent les données, pas la sécurité ou la rentabilité du token.
- Les narratifs sont classés localement à partir de mots-clés dans les noms, symboles et descriptions des tokens découverts sur 1h/24h. Aucune mention X, audience, sentiment ou engagement n'est collecté.

## Prévisions et faux signaux

Les prévisions conservent les excursions maximales favorables et défavorables observées pendant leur suivi, en plus du rendement au point de résolution. Une cohorte prospective enregistre désormais le premier prix observable pour chaque token découvert, sans seuil minimum de liquidité, puis résout 15m/1h/6h/24h/7d; les tokens sans marché après 30 minutes restent dans le dénominateur et les marchés qui arrivent plus tard sont marqués comme tardifs. Une calibration walk-forward trie les premiers signaux résolus par mint dans l'ordre chronologique : les 80% les plus anciens servent à sélectionner un seuil et les 20% les plus récents restent en validation. Le résultat est comparé au rendement de toute la validation et à un échantillon aléatoire déterministe de même taille. Le seuil n'est pas appliqué automatiquement. Cette séparation réduit la fuite temporelle, mais ne supprime pas le biais de survivance des tokens découverts par le scanner. Le seuil d'alerte configuré reste prioritaire jusqu'à disposer d'au moins 20 tokens indépendants en validation, d'au moins 55% de résultats à +15%, d'un rendement moyen positif et d'au plus 25% de pertes de 20% ou plus; seule cette validation peut ensuite faire évoluer le seuil d'alerte. Le benchmark historique présente aussi des cohortes de gagnants, survivants et tokens boom-bust, avec rendement final et drawdown maximal sur les bougies disponibles. Ce benchmark reste un proxy journalier, limité à l'historique indexé par GeckoTerminal. Le tableau Résultats affiche aussi, parmi les signaux avec score d'au moins 65, la part qui a subi une forte perte ou une forte baisse de liquidité à 1h. Ce chiffre est un proxy de faux signaux risqués; il ne constitue pas une preuve qu'un token a fait rug pull. Les résultats ne sont pas des performances de trading exécuté.

## Deuxième avis de sécurité gratuit (GL1TCH)

Automatiquement, MEME RADAR demande aussi un rapport indépendant à l'API publique de GL1TCH pour les cinq candidats prioritaires du contrôle de sécurité, environ toutes les dix minutes, et à l'ouverture d'une fiche token si le rapport est absent ou périmé. Aucun abonnement ni clé API n'est requis. Le rapport peut apporter des signaux complémentaires sur les wallets liés, les volumes artificiels, l'historique du déployeur, les extensions Token-2022, les métadonnées et la liquidité. Le score et le verdict GL1TCH sont affichés séparément : ils ne sont pas mélangés au score MEME RADAR, car les échelles et méthodes des deux projets ne sont pas nécessairement comparables.

Le résultat est mis en cache 30 minutes en cas de succès et 5 minutes en cas d'échec. MEME RADAR plafonne ses propres appels à 30 par minute pour rester sous la limite publique annoncée par GL1TCH (40/minute par IP). Le module est facultatif du point de vue du fonctionnement : si GL1TCH est indisponible, le scanner local continue normalement. Aucun nouveau secret, abonnement ou variable FadeHost n'est requis.

**Limites :** il s'agit d'un service tiers gratuit, soumis à sa disponibilité, à ses quotas et à ses conditions qui peuvent évoluer. Le rapport n'est pas une garantie et ne remplace pas les vérifications locales. Source et licence du projet : [GL1TCH (MIT)](https://github.com/gl1tchbased-pixel/gl1tch-coin).

## Modules d'intelligence

- **Analyse créateur (proxy)** : regroupe les tokens par mint/freeze authority exposée par les contrôles RPC. Ce n'est pas une identification certaine du créateur initial.
- **Wallet intelligence** : observe les variations nettes de soldes SPL dans les transactions récentes des wallets ajoutés. Les prix au moment exact de chaque transaction, le PnL net, les frais et le slippage ne sont pas certifiés.
- **Backtesting** : compare le prix d'un snapshot au premier snapshot disponible après 1, 5, 15 et 30 minutes, puis segmente les résultats selon le score initial. Les résultats s'accumulent à partir du déploiement et n'incluent ni frais, ni slippage, ni tokens jamais découverts.

## Benchmark historique par cohortes

Le module de backtesting propose un replay exploratoire sur BONK, WIF, POPCAT, BOME, MEW, TRUMP, PENGU, FARTCOIN, PNUT, MOODENG, GOAT, GIGA, PONKE, CHILLGUY, WEN, MYRO, SAMO, SLERF, VINE, MELANIA, USELESS, ZEREBRO, LIBRA, HAWK, CAR, JELLYJELLY, ACT, BERT, MANEKI, MOTHER, UFD et BELIEVE via GeckoTerminal Public API. Les nouveaux tokens sont résolus par recherche de pools, puis leur pool le plus liquide est sélectionné. Les cohortes couvrent gagnants de cycle, tokens à forte volatilité, phases de boom/bust, corrections et longues traînes; ces étiquettes décrivent des familles de cas à tester, pas une affirmation que chaque token est un rug ou un échec. Il récupère le pool le plus liquide indexé puis jusqu'à 180 bougies journalières. Les tokens sans adresse fiable ne sont plus résolus par simple sous-chaîne du nom de pool : le symbole ou nom exact doit être présent dans les métadonnées du token, sinon le cas est signalé comme non résolu. Chaque signal historique expose aussi le rendement de clôture à 1, 3 et 7 jours, les excursions favorables/défavorables à 7 jours, ainsi que les résultats agrégés des alertes comparés à l'ensemble des signaux. Les horizons sans bougie future suffisante restent non évalués. Le score historique est un **proxy** basé sur le volume relatif des 7 jours précédents et le momentum de prix sur 3/7 jours : il ne peut pas reconstruire les transactions acheteurs/vendeurs, la liquidité historique, les détenteurs, les autorités de sécurité ni les wallets smart money. Il ne reproduit donc pas exactement le score live.

La fenêtre OHLCV publique est limitée et les tokens plus anciens ne sont pas rejoués depuis leur lancement; le benchmark étudie uniquement la période renvoyée par la source. Comme la liste contient des gagnants connus, elle mesure la capacité à repérer des hausses chez des survivants, pas la précision sur l'ensemble des tokens perdants. Données source : [GeckoTerminal Public API](https://api.geckoterminal.com/docs/index.html), environ 10 appels/minute; le dashboard collecte les tokens progressivement. Le même endpoint sert désormais aussi à la découverte des pools récents.

## Apprentissage continu des prévisions

Toutes les 15 minutes, pour tous les pools suivis avec un prix et une liquidité strictement positifs (y compris sous 1 000 USD), MEME RADAR enregistre une prévision immuable (score, couverture, classification, risque, liquidité, volume et prix), puis la compare automatiquement à la première observation disponible après 15 minutes, 1 heure, 6 heures, 24 heures et 7 jours. Il calcule les rendements, variations de liquidité et taux de gagnants/perdants par horizon et par tranche de score, puis segmente les résultats par source de découverte (Pump.fun, GeckoTerminal, DexScreener), par âge du pool et par tranche de liquidité (<1k, 1k–5k, 5k–25k, 25k+). Les pools peu profonds restent séparés pour éviter de confondre leur volatilité avec celle des pools plus liquides. Les résultats restent attachés aux prévisions et sont persistés dans `data/store.json`; ils survivent donc aux redémarrages si le stockage FadeHost est persistant.

Le système fournit une calibration et une tranche de score historiquement la plus prometteuse seulement à partir d'au moins 30 observations résolues à 1 heure. **Il ne modifie pas automatiquement les poids ni les seuils du scanner** : les mesures live ne suffisent pas encore pour éviter le surapprentissage. Il faudra ensuite comparer ces recommandations sur une période de validation qui n'a pas servi à les établir. Une observation manquante ou un scanner arrêté peut empêcher la résolution d'un horizon.

## Installation sur FadeHost

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
- Le scanner crée `data/store.json` automatiquement, écrit de façon atomique et conserve une copie périodique `data/store.json.bak` du dernier état valide (au plus une fois par heure). En cas de fichier principal illisible au redémarrage, la copie est utilisée automatiquement. Le dossier `data/` doit être persistant sur FadeHost.
- Les variables secrètes doivent rester dans le panneau FadeHost, jamais dans le dépôt GitHub.


### Échantillons de transactions GeckoTerminal

Les transactions publiques GeckoTerminal observées lors d'une analyse de pool sont désormais enregistrées dans l'historique des wallets, avec leur signature, leur mint, leur slot, leur horodatage, leur direction et leur volume USD. L'ingestion est idempotente et l'historique est borné à 5 000 événements. Cela enrichit le graphe des wallets au-delà des seuls wallets surveillés manuellement ou découverts comme acheteurs précoces. Cette source reste un échantillon public limité aux pools analysés et aux 300 dernières transactions retournées; elle ne représente pas l'ensemble des échanges du marché.


### Cas historiques documentés de pertes

La page de test historique présente séparément des études de cas documentées (dont SHARPEI en octobre 2024 et une sortie de pool TWS analysée par CertiK). Ces cas illustrent des schémas de ventes concentrées et de sorties de liquidité, mais ne sont **pas** injectés dans les métriques de replay ni dans l'entraînement du score : sans série OHLCV historique complète et correspondance de mint vérifiée pour l'incident, cela créerait une fausse précision. Les sources sont liées directement dans le tableau de bord.


### Détection de groupes de wallets et bundles candidats

Le graphe analyse les achats observés par mint et par slot, ainsi que les rafales d'au moins trois wallets distincts dans une fenêtre de cinq secondes. Il recherche aussi les groupes de wallets qui réapparaissent ensemble sur plusieurs tokens. Les preuves sont séparées entre transactions RPC confirmées et échantillons GeckoTerminal. Les résultats sont nommés « groupes candidats » ou « bundle-like » : ils ne prouvent pas une coordination, un contrôle commun ou un bundle on-chain. Les transactions observées restent limitées à la couverture du RPC et aux pools effectivement inspectés.


### Comparaison des alertes par cohorte historique

Le benchmark agrège maintenant les résultats des alertes à poids égal par token dans chaque cohorte (cycle winners, survivants, boom-bust, long-tail et forte volatilité). Il affiche, à 1/3/7 jours, le rendement moyen par token, la proportion moyenne de tokens ayant atteint +15%, la proportion ayant touché -20% et l'écart moyen entre alertes et tous les signaux du même token. Cette agrégation évite qu'un token avec davantage de bougies domine les statistiques. Les signaux quotidiens et leurs fenêtres futures se chevauchent : ils ne sont pas indépendants. Les cohortes restent un échantillon de cas connus et ne constituent pas un univers exhaustif ni un backtest de lancement à lancement.


Le benchmark inclut désormais les mints vérifiés de HAWK (lancement du 4 décembre 2024) et LIBRA (14 février 2025) dans les cohortes quantitatives GeckoTerminal. Les cas SHARPEI et TWS restent uniquement documentaires tant qu'une adresse de mint historique fiable n'est pas établie. Les drawdowns publiés sont des chiffres rapportés par les sources, pas des calculs de notre replay.
