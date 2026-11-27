# MEME RADAR — version gratuite

Dashboard privé de recherche de meme coins Solana. Le projet utilise des sources publiques gratuites : DexScreener, GeckoTerminal, Bluesky public search, X (optionnel via session personnelle), PumpPortal (créations/migrations) et le RPC public Solana. Telegram est facultatif. Aucun fournisseur payant, aucune clé API payante, aucun wallet de trading et aucune signature de transaction.

### Connecteur X facultatif (session personnelle)

Le connecteur X est désactivé tant que `X_AUTH_TOKEN` et `X_CT0` ne sont pas configurés dans les variables privées de FadeHost. Les deux cookies de session sont secrets : ne les publie jamais dans le dépôt, un chat ou les logs. Il utilise le SDK Node.js `x-agent-sdk` (MIT), sans runtime Python : une seule session, une recherche par cycle social de 10 minutes, trois requêtes configurables qui tournent d'un cycle à l'autre, 20 publications maximum par recherche et cache de dix minutes. Le code n'effectue aucune publication, aucun like, aucun repost et aucun suivi.

Configure les deux variables privées `X_AUTH_TOKEN` (cookie `auth_token`) et `X_CT0` (cookie `ct0`). Ne colle jamais ces valeurs dans le dépôt, un chat ou les logs; révoque la session si elle est exposée. `X_SEARCH_QUERIES` peut contenir jusqu'à trois recherches séparées par des points-virgules.

Ce connecteur utilise l'API web privée non documentée de X. Il peut casser, être limité ou entraîner une restriction du compte. L'activation est volontaire; respecte les règles de X et ses limites. Une seule session est utilisée, sans rotation de comptes ni contournement des limites.

## Fonctions disponibles sans payer

| Fonction | Source | Configuration |
|---|---|---|
| Découverte de tokens | DexScreener (profils, boosts et reprises communautaires — découverte uniquement, sans bonus de score ni de sécurité) + GeckoTerminal (nouveaux pools multi-DEX) + PumpPortal (Pump.fun) + RPC Solana direct (Raydium LaunchLab (LetsBonk, StonkFun), Meteora DBC (Moonshot, Bags, Blocks, Bots Family, FarmFun, Jupiter Studio)) | Rien |
| Découverte pré-marché multi-launchpads | Abonnements RPC WebSocket aux logs des programmes LaunchLab et Meteora DBC, filtrage des instructions de création, capture du mint et du créateur avant indexation DEX | Rien |
| Prix, liquidité, volume, transactions, âge de la paire | DexScreener | Rien |
| Vérification de route de vente sur les meilleurs candidats | Jupiter Swap API V2 `/order` sans `taker`, une requête maximum par scan, montant plafonné à 0,5 % de la supply connue | Rien |
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
| Mentions et sentiment communautaire indicatif | Recherche publique Bluesky + relais Nostr NIP-50; Telegram public; X facultatif via SDK Node `x-agent-sdk` à session unique | X_AUTH_TOKEN + X_CT0 |
| Analyse des transactions récentes, diversité acheteurs, concentration, bursts 5 secondes et clusters same-block de type bundle | GeckoTerminal pool trades (jusqu'à 300 transactions observées), persistées dans l'historique wallet avec source et déduplication par signature | Rien |
| Graphe des wallets | Financeurs communs des créateurs observés et achats rapprochés répétés sur plusieurs tokens; niveaux de preuve distincts | Rien |
| Ajustement limité du score avec qualité des transactions et signal social public | Module local candidate-intel, GeckoTerminal + Bluesky + Nostr + Telegram + X selon disponibilité | Rien |
| Calibration hors échantillon | Walk-forward chronologique par mint : premiers 80% des signaux en entraînement, 20% les plus récents en validation, avec comparaison à une base aléatoire et au taux global | Rien |
| Cohorte prospective sans filtre de liquidité minimum | Tous les tokens découverts avec premier prix observable, y compris pools très faibles et absence de marché après 30 min | Rien |
| Qualité des données | Complétude et fraîcheur par token, catégories manquantes et échantillons disponibles | Rien |
| Continuité RPC Solana | Endpoint configuré en priorité, puis bascule automatique vers deux RPC publics alternatifs avec cooldown par fournisseur | Rien |
| Cohortes historiques gagnants / survivants / boom-bust | Bougies publiques GeckoTerminal, replay proxy journalier, rendements fixes à 1j/3j/7j après chaque signal, rendement final et drawdown | Rien |
| Enrichissement automatique du meilleur candidat GeckoTerminal et d'un créateur observé à la fois | Quotas publics maîtrisés, une analyse de pool par cycle et un financement créateur toutes les 15 minutes au maximum | Rien |
| Alertes Telegram | Telegram Bot API | Bot token + canaux configurés dans le dashboard (ancien chat ID migré) |
| Dashboard et état actif | Express + JSON compact pour les 7 000 tokens chauds et les données opérationnelles | Variables d'accès + stockage persistant FadeHost |
| Archive froide des tokens | SQLite natif Node.js, jusqu'à 50 000 tokens archivés, chargement par lots | Aucune clé API ni dépendance native à compiler |

**Limites importantes :**
- GeckoTerminal ajoute les nouveaux pools indexés sur plusieurs DEX Solana (jusqu'à 100 pools sur cinq pages publiques et fenêtre récente). PumpPortal suit les créations/migrations Pump.fun. Le scanner s'abonne aussi aux logs RPC WebSocket des programmes Raydium LaunchLab et Meteora DBC : seuls les logs d'instructions de création sont mis en file, puis la transaction est décodée pour récupérer le mint/créateur avant l'indexation DEX. Les deux programmes sont surveillés simultanément; le traitement est limité à une transaction de création par cycle et la file persistante est bornée. Si le WebSocket est indisponible, le statut l'indique et les sources PumpPortal/GeckoTerminal continuent de fonctionner. Le démarrage ouvre les abonnements en temps réel et ne rejoue pas les créations antérieures à la connexion. Les autres launchpads (notamment Heaven, Pangea, kids.fun et Boop en tant que programme indépendant) ne sont pas encore surveillés directement.
- Le RPC public Solana est partagé et soumis à des limites de débit. Si FadeHost ou d'autres utilisateurs envoient trop de requêtes, certaines vérifications peuvent échouer temporairement. On peut renseigner un autre endpoint RPC public/gratuit dans `SOLANA_RPC_URL`, sans garantie de disponibilité.
- Les contrôles on-chain donnent des observations : ils ne prouvent pas que la liquidité est verrouillée, qu'un token est vendable ou qu'un contrat est sûr.
- Le contrôle de vendabilité demande un devis de vente en lecture seule à Jupiter Swap API V2 pour un seul candidat prioritaire par scan (environ 100 USD, plafonné à 0,5 % de la supply si elle est connue). Il ne fournit aucun wallet, ne construit ni ne signe de transaction et ne simule pas l'exécution on-chain. Une route disponible est un indice de routage, pas une garantie d'exécution; l'absence de route n'est pas une preuve de honeypot. Les devis dépendent des limites de Jupiter et peuvent être temporairement indisponibles.
- La concentration des détenteurs agrège les comptes SPL par wallet propriétaire sur les 20 plus gros comptes renvoyés par le RPC, puis calcule top 1 / top 5 / top 10 wallets. La concentration brute des 10 comptes est également affichée. C'est plus fiable qu'un simple classement de comptes, mais ce n'est pas une cartographie complète des bénéficiaires : les wallets liés entre eux ne sont pas fusionnés, et les comptes de pool ou de contrats peuvent apparaître dans le classement.
- Le suivi des wallets combine jusqu'à 10 adresses manuelles, 5 acheteurs précoces découverts automatiquement et 5 wallets créateurs observés dans les événements Pump.fun. Les acheteurs automatiques sont des candidats à observer, pas des wallets réputés rentables. La performance affichée compare un snapshot de prix proche de l'achat observé à un snapshot disponible environ une heure après; si ces observations manquent, le résultat n'est pas compté. Ce n'est pas le PnL réel du wallet. Les clusters ne concernent que les wallets surveillés et ne prouvent pas qu'ils sont liés. Les transactions d'un wallet créateur sont surveillées : une baisse de solde du token accompagnée d'une entrée SOL/USDC/USDT dans la même transaction est classée « swap-like »; une baisse sans quote asset entrant est seulement une sortie de tokens non confirmée (transfert, burn ou autre). Les données de soldes ne prouvent pas à elles seules l'intention économique.
- Le module social utilise Bluesky public search, Nostr, Telegram public et X facultatif. Le flux DexScreener des reprises communautaires est consulté au maximum toutes les cinq minutes, limité aux 30 premiers mints Solana valides, et sert uniquement à découvrir des tokens — jamais à augmenter leur score ou leur niveau de sécurité. Reddit RSS est désactivé; les canaux Telegram dont le nom évoque des appels, gems, moonshots, pumps, signaux, trending ou 100x sont classés heuristiquement comme promotionnels et ne comptent pas comme preuve communautaire indépendante; cette classification peut produire des faux positifs. Bluesky est interrogé par cashtag exact; les symboles courts/ambigus sont ignorés. Les services publics peuvent refuser ou limiter la recherche, auquel cas le statut l'indique sans inventer de mentions. X ne fait pas l'objet d'une recherche globale et dépend d'une session facultative; Telegram est limité aux canaux publics découverts ou référencés, jamais aux groupes privés. Le signal combine les mentions et la diversité de sources non promotionnelles; le sentiment lexical est pris uniquement depuis Bluesky/Nostr/X, jamais depuis l'agrégat Telegram. Il ne mesure pas une audience fiable. Les sources peuvent limiter les requêtes; leurs erreurs n'empêchent pas le scanner de fonctionner. Le tableau des narratifs combine désormais les thèmes repérés dans les noms/descriptions des tokens avec les mentions publiques réellement associées au mint ou au nom exact. Il expose les tokens récents, les mentions à 1 h / 24 h, les auteurs et réseaux distincts, et une accélération seulement lorsqu'un échantillon indépendant minimal existe. Les publications Telegram promotionnelles, les correspondances ticker ambiguës et les posts hors fenêtre sont exclus de cette preuve. Cela reste une mesure d'activité observée, pas une mesure d'audience ni une prédiction de prix. Reddit RSS est retiré par Reddit depuis novembre 2026 et reste désactivé. TikTok et Google Trends ne sont pas intégrés : aucune collecte non officielle ou donnée simulée n'est présentée comme une source fiable.
- L'analyse des détenteurs utilise uniquement les 20 plus gros comptes renvoyés par le RPC public. Elle ne détecte pas les liens indirects entre wallets (même personne, financement commun, bundles) et ne doit pas être interprétée comme une preuve d'identité. Les liens sociaux publics restent visibles.
- Les scores sont des indicateurs heuristiques, pas des probabilités de hausse ni des conseils d'achat. Les signaux de momentum et les variations de liquidité ne deviennent exploitables qu'après plusieurs observations espacées; au premier scan, l'historique est incomplet.
- Les mesures de volume/liquidité et FDV/liquidité sont des ratios descriptifs, pas des preuves de liquidité réellement retirable. Les données DexScreener peuvent être retardées ou incomplètes.
- Les bundles, snipers et liens de financement entre wallets ne sont pas prouvés automatiquement. Les flux PumpPortal de créations/migrations sont gratuits; ses flux détaillés d'achats/ventes sont payants et ne sont volontairement pas activés. Les signaux de concentration et de pression vendeuse sont des heuristiques, pas des preuves de manipulation.

## Intelligence élite en cinq phases

Le module `lib/elite-intelligence.js` expose cinq analyses complémentaires et leurs limites :

1. **Demande organique** : recoupement des acheteurs/vendeurs observés, sorties rapides du même wallet, répétition des montants et rafales déjà détectées. Une pénalité n'est appliquée qu'avec un échantillon minimal et une confiance suffisante; ce n'est jamais une preuve de wash trading.
2. **Réseau de wallets** : récurrence des acheteurs entre tokens suivis et financeurs directs communs des créateurs. Les services partagés et traders actifs sont explicitement signalés comme faux positifs possibles.
3. **Détenteurs et sécurité** : contrôle de la disponibilité de la concentration des propriétaires, des comptes inconnus et des extensions Token-2022. Les données manquantes restent partielles et ne sont pas inventées.
4. **Validation des résultats** : expose les conditions du holdout chronologique déjà calculé par le moteur d'apprentissage. Aucun seuil ni poids n'est modifié automatiquement par cette phase.
5. **Couverture de découverte** : affiche les sources actuellement observées et liste séparément Heaven, Pangea, kids.fun et Boop comme non intégrés. Ces launchpads ne sont pas prétendus surveillés; leur intégration nécessite leurs vrais programmes/API et des tests de décodage.

Le résumé des cinq phases est disponible dans `/api/overview` sous `eliteIntelligence`; chaque analyse de token expose ses résultats dans `analysis.eliteIntelligence`. Les signaux nouveaux n'ajoutent qu'une pénalité bornée et seulement lorsque les observations sont suffisamment étayées. Aucune signature, transaction d'achat ou connexion de wallet n'est effectuée.

## Calibration prudente de la sélection

Le seuil de score de la sélection principale démarre à 68/100. Il ne peut être ajusté qu'à partir d'une validation chronologique hors échantillon : au moins 20 tokens dans la validation, au moins 20 tokens au seuil retenu, au moins 55 % ayant atteint +15 % à environ 1 h, rendement moyen positif et au plus 25 % ayant subi une baisse de 20 % ou plus. Si une seule condition manque, le seuil reste à 68/100. Le dashboard indique si le seuil est validé ou s'il utilise encore la valeur prudente par défaut. Cette calibration n'apprend pas les poids du score et ne transforme pas le score en probabilité de hausse.

## Base hybride à mémoire bornée

Le scanner conserve un cache actif limité à 10 000 tokens par défaut dans `data/store.json` (`HOT_TOKEN_LIMIT` réglable entre 1 200 et 12 000). Les tokens qui sortent de ce cache sont archivés dans `data/tokens.archive.sqlite`, avec un historique et des prévisions compactés. L'archive est plafonnée à 50 000 entrées par défaut (`TOKEN_ARCHIVE_MAX` peut régler ce plafond entre 1 000 et 100 000). À chaque scan, jusqu'à 50 tokens archivés sont réintroduits temporairement pour une nouvelle vérification (`TOKEN_ARCHIVE_SCAN_BATCH`, maximum 50), avec un délai de revisite de 15 minutes. Lorsqu'un flux de découverte retrouve directement un mint archivé (PumpPortal, LaunchLab/Meteora ou autre source indexée), le token est immédiatement réveillé dans le cache actif et le compteur `archiveWakeups` indique la source; la vérification de marché peut traiter jusqu'à 360 adresses par cycle (12 lots séquentiels maximum de 30), contre 200 auparavant. Le lot tournant de nouvelles découvertes peut atteindre 240 mints; la sélection réserve d'abord les mises à jour Telegram, la watchlist et les lancements récents, puis les candidats scorés, les signaux sociaux et l'archive, avant les tokens actifs généraux et les nouvelles découvertes. Les lots restent séquentiels pour éviter les pics mémoire et les rafales de requêtes.

SQLite utilise le module natif `node:sqlite` : le runtime doit être Node.js 22.5 ou ultérieur dans la branche 22, ou Node.js 26. Le fichier SQLite doit rester dans le dossier persistant `data` de l'hébergement. Si SQLite n'est pas disponible, le scanner désactive l'archive et conserve son ancien plafond actif au lieu de prétendre avoir étendu la base. La taille de la base et le nombre total conservé sont exposés dans l'aperçu du dashboard. Le compteur de réveils d'archive est exposé dans le diagnostic runtime. L'archive augmente la capacité de conservation, mais ne signifie pas que 50 000 tokens sont tous rescannés chaque minute : le traitement reste échelonné pour protéger la RAM et les quotas des API publiques.

## Scoring enrichi et collecte automatique

Le score principal conserve ses facteurs de marché, de momentum, de liquidité, de sécurité, de wallets suivis et de timing. Un ajustement complémentaire plafonné à +/- 6 points utilise uniquement les données réellement disponibles : qualité de l'échantillon de transactions GeckoTerminal et signal social public Bluesky/Nostr/Telegram/X. Ces sous-scores ne gonflent pas le pourcentage de couverture des données. En l'absence de données, aucun facteur n'est inventé. La fiche token expose le score de base, l'ajustement et les raisons observées.

Le scanner enrichit automatiquement un pool GeckoTerminal candidat par cycle, en respectant un espacement d'au moins 15 secondes entre les appels de transactions, et examine au maximum un financement de créateur observé toutes les 15 minutes. Ces vérifications restent limitées par les quotas RPC/API publics et peuvent être indisponibles. Un même bloc ou un financeur commun est un indice à examiner, jamais une preuve de manipulation ou d'identité commune.

## Découverte multi-DEX gratuite

À chaque cycle, MEME RADAR interroge séquentiellement cinq pages GeckoTerminal par défaut (jusqu'à environ 100 pools récents avant déduplication). Pour éviter de rester bloqué sur les seules pages les plus récentes, les pages parcourues tournent sur une fenêtre persistante de 10 pages : par défaut, le scanner couvre les pages 1–5, puis 6–10 avant de recommencer. La taille du lot reste configurable via `GECKO_NEW_POOL_PAGES` (1 à 5) et la fenêtre via `GECKO_NEW_POOL_PAGE_WINDOW` (1 à 10, défaut 10). Le curseur est sauvegardé avec l'état du scanner et survit aux redémarrages. Chaque page est traitée puis libérée avant la suivante : aucune réponse API volumineuse n'est conservée en parallèle. Les pools sont dédupliqués par adresse de pool et les tokens par mint. Le lot de 100 mints envoyé à l'enrichissement DexScreener tourne lui aussi entre les tokens découverts, au lieu de toujours favoriser les premières sources de la liste. En complément, le scanner interroge les pools tendance Solana GeckoTerminal toutes les cinq minutes (une requête supplémentaire au maximum sur cette période), sans ajouter de requête à chaque cycle. Ces pools sont identifiés séparément comme `geckoterminal_trending_pool`. En cas de HTTP 429 sur la découverte récente, la pagination et l'appel tendance du cycle s'arrêtent immédiatement. GeckoTerminal est une API publique sans clé, limitée à environ 10 appels/minute; avec un scan par minute, quatre pages consomment environ quatre appels par cycle, auxquels s'ajoutent les éventuels appels d'enrichissement. Les pools détectés sont ensuite enrichis par DexScreener dès qu'une paire est disponible.

## Social intelligence (public/free sources)

- Bluesky public search, Nostr NIP-50 relay search, Telegram public discovery and optional X search are sampled independently; promotional Telegram call channels are excluded from independent-community counts.
- Telegram collection rotates through a capped seed list of 50 public channels (4 per cycle) and reads up to three additional public `t.me/s/<channel>` pages linked in a token's DexScreener social metadata or description. It does not search all of Telegram and cannot read private groups.
- Telegram channel pages are cached for 15 minutes; up to three public channels per token and three token candidates per social refresh are inspected.
- Social summaries distinguish mentions, independent authors, Telegram channels and source-network diversity. Repeated identical snippets are surfaced as a possible amplification pattern, never proof of bots or coordination.
- X/Twitter is optional and uses a user-configured session through `x-agent-sdk`; it rotates one broad query per social cycle, not an exhaustive global search, and remains subject to private-interface limits and changes.
- Social evidence is a small, noisy auxiliary factor in the score and never overrides on-chain risk gates.

## Social Radar gratuit

Reddit RSS est désactivé (les flux ne sont plus collectés). `BlueskyRadar` utilise l'endpoint public `app.bsky.feed.searchPosts` sans authentification et traite jusqu'à cinq candidats par cycle. `NostrRadar` interroge un relais public NIP-50 (`relay.nostr.band`) pour un candidat supplémentaire par cycle, sans clé; les événements sont filtrés localement par symbole ou nom exact, dédupliqués et limités aux dernières 24 heures. Les résultats exposent uniquement les mentions observées au niveau des publications, les auteurs et la diversité des sources non promotionnelles. Le sentiment lexical provient de Bluesky/Nostr/X; l'agrégat Telegram n'est pas utilisé pour le sentiment. X reste facultatif : avec une session personnelle configurée, le radar fait tourner une requête publique large par cycle parmi trois requêtes (Pump.fun, memecoins Solana et adresses CA). Ce balayage n'est pas exhaustif et dépend des limites de l'interface X; il peut découvrir des mints publiés, mais ne garantit pas une couverture globale du marché. Telegram tourne sur une liste seed de 50 canaux publics (4 par cycle) et lit jusqu'à trois pages `t.me/s` publiques liées aux métadonnées sociales ou à la description DexScreener du token; aucune recherche globale ni lecture des groupes privés. La recherche Nostr dépend du support NIP-50 et de la disponibilité du relais public; un échec est affiché comme source indisponible et n'interrompt pas le scanner.

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
- Les narratifs combinent les thèmes détectés dans les noms/descriptions des tokens récents et les publications publiques associées au mint ou au nom exact. Le tableau expose les mentions 1h/24h, les auteurs et réseaux distincts, et une accélération uniquement si un minimum d'auteurs et de mentions récentes est observé. Les tickers ambigus, posts hors fenêtre et canaux Telegram promotionnels sont exclus. Cela mesure des publications observées, pas l'audience réelle ni l'intention d'achat.

## Prévisions et faux signaux

Les prévisions conservent les excursions maximales favorables et défavorables observées pendant leur suivi, en plus du rendement au point de résolution. Une cohorte prospective enregistre désormais le premier prix observable pour chaque token découvert, sans seuil minimum de liquidité, puis résout 15m/1h/6h/24h/7d; les tokens sans marché après 30 minutes restent dans le dénominateur et les marchés qui arrivent plus tard sont marqués comme tardifs. Une calibration walk-forward trie les premiers signaux résolus par mint dans l'ordre chronologique : les 80% les plus anciens servent à sélectionner un seuil et les 20% les plus récents restent en validation. Le résultat est comparé au rendement de toute la validation et à un échantillon aléatoire déterministe de même taille. Le seuil n'est pas appliqué automatiquement. Cette séparation réduit la fuite temporelle, mais ne supprime pas le biais de survivance des tokens découverts par le scanner. Le seuil d'alerte configuré reste prioritaire jusqu'à disposer d'au moins 20 tokens indépendants en validation, d'au moins 55% de résultats à +15%, d'un rendement moyen positif et d'au plus 25% de pertes de 20% ou plus; seule cette validation peut ensuite faire évoluer le seuil d'alerte. Le benchmark historique présente aussi des cohortes de gagnants, survivants et tokens boom-bust, avec rendement final et drawdown maximal sur les bougies disponibles. Ce benchmark reste un proxy journalier, limité à l'historique indexé par GeckoTerminal. Le tableau Résultats affiche aussi, parmi les signaux avec score d'au moins 65, la part qui a subi une forte perte ou une forte baisse de liquidité à 1h. Ce chiffre est un proxy de faux signaux risqués; il ne constitue pas une preuve qu'un token a fait rug pull. Les résultats ne sont pas des performances de trading exécuté.

## Deuxième avis de sécurité gratuit (GL1TCH)

Automatiquement, MEME RADAR demande aussi un rapport indépendant à l'API publique de GL1TCH pour les cinq candidats prioritaires du contrôle de sécurité, environ toutes les dix minutes, et à l'ouverture d'une fiche token si le rapport est absent ou périmé. Aucun abonnement ni clé API n'est requis. Le rapport peut apporter des signaux complémentaires sur les wallets liés, les volumes artificiels, l'historique du déployeur, les extensions Token-2022, les métadonnées et la liquidité. Le score et le verdict GL1TCH sont affichés séparément : ils ne sont pas mélangés au score MEME RADAR, car les échelles et méthodes des deux projets ne sont pas nécessairement comparables.

Le résultat est mis en cache 30 minutes en cas de succès et 5 minutes en cas d'échec. MEME RADAR plafonne ses propres appels à 30 par minute pour rester sous la limite publique annoncée par GL1TCH (40/minute par IP). Le module est facultatif du point de vue du fonctionnement : si GL1TCH est indisponible, le scanner local continue normalement. Aucun nouveau secret, abonnement ou variable FadeHost n'est requis.

**Limites :** il s'agit d'un service tiers gratuit, soumis à sa disponibilité, à ses quotas et à ses conditions qui peuvent évoluer. Le rapport n'est pas une garantie et ne remplace pas les vérifications locales. Source et licence du projet : [GL1TCH (MIT)](https://github.com/gl1tchbased-pixel/gl1tch-coin).

## Modules d'intelligence

- **Analyse créateur (proxy)** : regroupe les tokens par mint/freeze authority exposée par les contrôles RPC. Ce n'est pas une identification certaine du créateur initial.
- **Wallet intelligence** : observe les variations nettes de soldes SPL dans les transactions récentes des wallets ajoutés. Les prix au moment exact de chaque transaction, le PnL net, les frais et le slippage ne sont pas certifiés.
- **Suivi des prévisions et validation adaptative** : horizons 15 min, 1 h, 6 h, 24 h et 7 jours. Les calibrations, cohortes de sélection et backtests de signaux wallet utilisent des rendements nets d'un proxy de slippage lié à la liquidité (100 USD simulés, 0,5 % de base + 1,5 × montant/liquidité, plafond 15 %, repli 10 % si liquidité inconnue) et de 0,3 % de frais par côté. Une liquidité de sortie explicitement nulle est traitée comme une sortie impossible (-100 %); une liquidité inconnue conserve le repli conservateur de 10 %. Les rendements bruts restent disponibles séparément; ces simulations sur snapshots ne garantissent pas une exécution réelle. Les tokens jamais découverts restent hors échantillon.

## Benchmark historique par cohortes

Le module de backtesting propose un replay exploratoire sur BONK, WIF, POPCAT, BOME, MEW, TRUMP, PENGU, FARTCOIN, PNUT, MOODENG, GOAT, GIGA, PONKE, CHILLGUY, WEN, MYRO, SAMO, SLERF, VINE, MELANIA, USELESS, ZEREBRO, LIBRA, HAWK, CAR, JELLYJELLY, ACT, BERT, MANEKI, MOTHER, UFD et BELIEVE via GeckoTerminal Public API. Les nouveaux tokens sont résolus par recherche de pools, puis leur pool le plus liquide est sélectionné. Les cohortes couvrent gagnants de cycle, tokens à forte volatilité, phases de boom/bust, corrections et longues traînes; ces étiquettes décrivent des familles de cas à tester, pas une affirmation que chaque token est un rug ou un échec. Il récupère le pool le plus liquide indexé puis jusqu'à 180 bougies journalières. Les tokens sans adresse fiable ne sont plus résolus par simple sous-chaîne du nom de pool : le symbole ou nom exact doit être présent dans les métadonnées du token, sinon le cas est signalé comme non résolu. Chaque signal historique expose aussi le rendement de clôture à 1, 3 et 7 jours, les excursions favorables/défavorables à 7 jours, ainsi que les résultats agrégés des alertes comparés à l'ensemble des signaux. Les horizons sans bougie future suffisante restent non évalués. Le score historique est un **proxy** basé sur le volume relatif des 7 jours précédents et le momentum de prix sur 3/7 jours : il ne peut pas reconstruire les transactions acheteurs/vendeurs, la liquidité historique, les détenteurs, les autorités de sécurité ni les wallets smart money. Il ne reproduit donc pas exactement le score live.

La fenêtre OHLCV publique est limitée et les tokens plus anciens ne sont pas rejoués depuis leur lancement; le benchmark étudie uniquement la période renvoyée par la source. Comme la liste contient des gagnants connus, elle mesure la capacité à repérer des hausses chez des survivants, pas la précision sur l'ensemble des tokens perdants. Données source : [GeckoTerminal Public API](https://api.geckoterminal.com/docs/index.html), environ 10 appels/minute; le dashboard collecte les tokens progressivement. Le même endpoint sert désormais aussi à la découverte des pools récents.

## Apprentissage continu des prévisions

Toutes les 15 minutes, pour tous les pools suivis avec un prix et une liquidité strictement positifs (y compris sous 1 000 USD), MEME RADAR enregistre une prévision immuable (score, couverture, classification, risque, liquidité, volume et prix), puis la compare automatiquement à la première observation disponible après 15 minutes, 1 heure, 6 heures, 24 heures et 7 jours. Il calcule les rendements, variations de liquidité et taux de gagnants/perdants par horizon et par tranche de score, puis segmente les résultats par source de découverte (Pump.fun, GeckoTerminal, DexScreener), par âge du pool et par tranche de liquidité (<1k, 1k–5k, 5k–25k, 25k+). Les pools peu profonds restent séparés pour éviter de confondre leur volatilité avec celle des pools plus liquides. Les résultats restent attachés aux prévisions et sont persistés dans `data/store.json`; ils survivent donc aux redémarrages si le stockage FadeHost est persistant.

Le système fournit une calibration et une tranche de score historiquement la plus prometteuse à partir des prévisions résolues. Un moteur adaptatif distinct apprend les relations entre les facteurs figés au moment du signal et les résultats observés. Il ne peut influencer que l'ordre des candidats déjà éligibles : les contrôles de sécurité, seuils de liquidité, fraîcheur, couverture et critères d'accès à la sélection principale restent inchangés. Son activation exige au moins 250 tokens distincts résolus à 1 heure (200 entraînement chronologique, 50 validation), un top d'au moins 15 tokens et un avantage d'au moins 5 points face au score fixe et à un témoin aléatoire de même taille. L'évaluation utilise des rendements nets simulés avec 0,5 % de slippage et 0,3 % de frais par côté, aux horizons 15m/1h/6h/24h/7d; ce ne sont pas des profits exécutables. Si le modèle n'atteint pas ces preuves, le classement fixe reste actif. Les résultats restent exposés dans le dashboard pour suivre l'apprentissage sans surajuster. Une observation manquante ou un scanner arrêté peut empêcher la résolution d'un horizon.

## Installation sur FadeHost

1. Connecte le dépôt GitHub ou mets à jour les fichiers de l'application.
2. Choisis **Node.js 20 ou supérieur**.
3. Dans le panneau FadeHost, configure les variables listées ci-dessous.
4. Lance l'installation des dépendances avec `npm install`.
5. Définis la commande de démarrage sur `npm start`.
6. Vérifie que le dossier `data/` est conservé lors des redémarrages et redéploiements.

## Variables FadeHost à configurer

### Obligatoires
- `DASHBOARD_ACCESS_CODE` : ton code privé non vide. L'ancien nom `DASHBOARD_PASSWORD` est aussi accepté automatiquement pour ne pas casser les déploiements existants. Pour la sécurité, évite un code trop facile à deviner.

### Facultatives mais recommandées
- `DASHBOARD_SESSION_SECRET` : secret stable d'au moins 32 caractères. Si tu ne le renseignes pas, le bot en génère un aléatoire dans `data/session-secret.key` et le réutilise aux redémarrages. Le dossier `data/` doit donc être persistant sur FadeHost. Si tu fournis un secret explicite, ne le change pas à chaque redémarrage.
- `DASHBOARD_URL` : URL HTTPS publique du dashboard. Elle sert au lien envoyé dans Telegram; le serveur peut démarrer sans elle.
- `NODE_ENV` : `production` (recommandé). Les cookies sont sécurisés en production.

Génère une valeur forte pour le secret de session avec cette commande sur une machine disposant de Node.js si tu préfères le définir toi-même :
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
Ne partage jamais ces secrets dans une conversation et ne les commits pas sur GitHub.

### Facultatives
- `TELEGRAM_BOT_TOKEN` : token obtenu auprès de @BotFather (variable recommandée). L'ancienne variable `BOT_TOKEN` reste acceptée.
- `TELEGRAM_CHAT_ID` : identifiant historique facultatif, migré comme canal principal si aucun canal n'a encore été configuré. Les nouveaux canaux se gèrent directement dans le dashboard.
- `SOLANA_RPC_URL` : endpoint RPC Solana alternatif. Si vide, le projet utilise automatiquement `https://api.mainnet.solana.com`.
- `PORT` : laisse la valeur attendue par FadeHost (souvent injectée automatiquement).
- `SCAN_INTERVAL_MS` : intervalle du scanner, par défaut 60000 (60 secondes).
- `GECKO_NEW_POOL_PAGES` : nombre de pages GeckoTerminal à parcourir par cycle (1 à 5), par défaut 5.
- `GECKO_NEW_POOL_PAGE_WINDOW` : fenêtre totale de pagination GeckoTerminal parcourue en rotation (1 à 10), par défaut 10; augmente la couverture historique sans augmenter le nombre de requêtes par cycle.
- `ALERT_MIN_SCORE` : score minimal d'alerte, par défaut 80.
- `MIN_LIQUIDITY_USD` : liquidité minimale, par défaut 5000 USD.

**Clés facultatives :** `HELIUS_API_KEY` active le RPC Helius en priorité avant les RPC publics de secours; `X_AUTH_TOKEN` et `X_CT0` activent la recherche X via une session personnelle. Aucune clé payante n'est requise. `BIRDEYE_API_KEY`, `X_BEARER_TOKEN` et `PUMPPORTAL_API_KEY` ne sont pas utilisés.

## Vérification de santé

- `GET /health` : liveness minimal, public et sans divulgation des erreurs internes.
- `GET /health/ready` : readiness du processus scanner.
- `GET /api/system/health` : détails des sources, réservé à une session authentifiée.

## Diffusion Telegram multi-canaux

Le dashboard propose une page **Canaux** : ajoute un identifiant numérique de chat (par exemple `-1001234567890`) ou le nom public d'un canal (par exemple `@moncanal`), puis active ou désactive sa diffusion. Le bot doit être administrateur du canal avec le droit de publier. Jusqu'à 10 canaux peuvent être configurés. Tous reçoivent les mêmes alertes qualifiées depuis un seul scanner; ajouter un canal ne déclenche aucun scan supplémentaire.

Les anciens déploiements qui utilisent `TELEGRAM_CHAT_ID` sont migrés vers un canal principal au premier démarrage, sans effacer les autres données. Une fois la configuration des canaux modifiée dans le dashboard, la liste enregistrée devient la référence, y compris si tous les canaux sont désactivés ou supprimés.

Les alertes Telegram sont compactes : nom/symbole, score M2/100 et verdict, couverture, capitalisation/FDV, liquidité, âge, statut de sécurité, une raison principale et adresse du token. Les boutons ouvrent DexScreener, GMGN et Axiom; aucun bouton d'achat n'est ajouté. Le score est une note heuristique de qualité des signaux observés, **pas une probabilité de hausse ni une promesse de rendement**. Les catégories sont : 90–100 exceptionnel, 80–89 très prometteur, 70–79 prometteur, 55–69 à surveiller, 0–54 peu intéressant. Une alerte de risque critique affiche un avertissement et ne peut pas être transformée en signal positif par son score.

La page **Résultats** mesure les tokens de la sélection principale : taux ayant atteint au moins +15 % à environ 1 h, rendements moyens et baisses importantes aux horizons disponibles. Une entrée par mint est suivie; les observations manquantes sont affichées séparément et ne sont pas comptées comme des pertes. Ces résultats utilisent les rendements nets du modèle de coûts versionné (slippage estimé selon la liquidité et 0,3 % de frais par côté); ils restent des simulations sur snapshots et ne garantissent pas qu'une transaction aurait pu être exécutée.

## Telegram

Commandes : `/start`, `/dashboard`, `/scan`, `/opportunities`, `/help`. Le bot démarre en long polling au lancement du serveur si `TELEGRAM_BOT_TOKEN` (ou `BOT_TOKEN`) est renseigné. Les alertes sont envoyées si le token Telegram est configuré et qu'au moins un canal est activé dans le dashboard (ou migré depuis l'ancien `TELEGRAM_CHAT_ID`).

## Sécurité et données

- Aucun achat/vente automatique, aucune clé privée et aucune signature de transaction.
- Le code d'accès est vérifié côté serveur.
- La session utilise un cookie HttpOnly signé, avec une durée navigateur de 10 ans. Le navigateur peut toujours supprimer ses cookies.
- Les sessions persistent au redémarrage si `DASHBOARD_SESSION_SECRET` reste identique.
- Le scanner crée `data/store.json` automatiquement, écrit de façon atomique et conserve une copie périodique `data/store.json.bak` du dernier état valide (au plus une fois par heure). En cas de fichier principal illisible au redémarrage, la copie est utilisée automatiquement. Si les deux fichiers sont illisibles, le fichier corrompu est conservé sous un nom `.corrupt-*` avant l'initialisation d'un état propre. Les structures JSON partielles ou d'ancienne version sont normalisées sans faire planter le serveur. Le dossier `data/` doit être persistant sur FadeHost.
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


## Backtests déportés vers GitHub Actions

Le benchmark OHLCV historique peut être exécuté hors de FadeHost par le workflow
`.github/workflows/historical-benchmark.yml` : lancement manuel ou chaque lundi
à 03:17 UTC. Le runner utilise Node.js 22, traite les tokens séquentiellement pour
respecter les limites publiques de GeckoTerminal, puis conserve un rapport JSON
comme artifact pendant 14 jours.

Pour importer automatiquement les résultats dans le dashboard :

1. Générer un secret aléatoire d'au moins 32 caractères (par exemple 64 caractères hexadécimaux).
2. Ajouter `MEME_RADAR_ACTIONS_TOKEN` dans les variables d'environnement FadeHost.
3. Ajouter le même secret dans GitHub : **Settings → Secrets and variables → Actions → New repository secret**, avec le nom `MEME_RADAR_ACTIONS_TOKEN`.
4. Lancer manuellement **Actions → MEME RADAR historical benchmark → Run workflow**.

Le point d'entrée HTTPS d'import est protégé par ce bearer token, accepte uniquement
les symboles du benchmark connus et valide les métriques avant de les sauvegarder.
Un échec partiel ne remplace pas un résultat terminé encore récent. Si le secret
n'est pas configuré, le workflow produit quand même l'artifact, mais n'importe rien
dans le dashboard. Ne jamais mettre ce secret dans le dépôt ou dans un fichier suivi
par Git.

Un second workflow, `.github/workflows/archive-learning.yml`, lance tous les deux jours
à 04:41 UTC (ou manuellement) une analyse de l'archive froide SQLite. Il lit
l'archive par pages de 200 tokens maximum, calcule les statistiques des prévisions
hors de FadeHost et entraîne aussi un modèle adaptatif compact à partir des premiers
résultats résolus par mint. Si ce modèle passe sa validation hors échantillon nette
de frais et slippage, il peut servir de repli au classement live lorsque le cache actif
ne contient pas encore assez de résultats. Un modèle actif validé reste prioritaire;
un modèle d'archive n'est accepté que si son rapport date de moins de cinq jours.
Le calcul lourd reste dans GitHub Actions et seul le résumé compact est renvoyé au
Dashboard. Le rapport JSON est conservé 30 jours. Il utilise le même secret `MEME_RADAR_ACTIONS_TOKEN`
et les routes HTTPS authentifiées `GET/POST /internal/actions/archive-learning`.
Cette analyse couvre l'archive froide, pas les 7 000 tokens actifs du fichier
principal; elle ne modifie aucun seuil de sélection. Si le secret est absent côté
GitHub, le workflow saute proprement l'analyse. S'il est absent côté FadeHost ou
ne correspond pas, l'API refuse l'export/import sans modifier les données.

Ce workflow déporte uniquement le benchmark historique OHLCV. Le scanner temps réel,
les alertes Telegram et les observations prospectives restent sur FadeHost. GitHub
Actions n'est pas un worker permanent et ne remplace pas l'hébergement du scanner.


## Qualité de distribution des détenteurs et réputation des wallets

Les contrôles de sécurité RPC exposent maintenant, en plus des concentrations top 1/5/10, des indicateurs de distribution sur les 20 plus grands comptes :
- Gini et HHI calculés sur l'échantillon observé;
- nombre effectif de détenteurs dans cet échantillon (inverse du HHI);
- concentration top 20, nombre de comptes et de propriétaires identifiés;
- part de la supply contenue dans les 20 comptes récupérés et nombre de propriétaires inconnus.

**Limite importante :** ce n'est pas une analyse de tous les détenteurs. Les métriques Gini/HHI sont des indicateurs partiels calculés sur les 20 comptes renvoyés par le RPC; les comptes inconnus sont traités comme des unités séparées pour ne pas les fusionner arbitrairement. Les pools, lockers, bonding curves et comptes d'infrastructure ne sont pas automatiquement identifiés ou exclus.

La page Wallet Intelligence calcule aussi un indice historique indicatif par wallet à partir du rendement du token environ une heure après le premier achat observable pour chaque token. Plusieurs achats du même wallet sur le même token ne comptent qu'une fois. Le score reste masqué avant cinq tokens évalués et est rétréci vers 50 lorsque l'échantillon est faible. Il ne représente pas le PnL réel du wallet : taille des positions, prix exact au bloc, frais, slippage et ventes exécutées ne sont pas connus. Il ne modifie pas automatiquement le score des tokens.


## Réputation des wallets suivis (Helius facultatif)

MEME RADAR ne télécharge pas de classement KOL externe et ne prétend pas connaître à l'avance les wallets rentables. Le classement est reconstruit localement à partir des wallets manuels, des acheteurs précoces découverts et des créateurs observés.

- `HELIUS_API_KEY` active Helius comme RPC prioritaire pour récupérer signatures et transactions; les RPC publics restent disponibles en secours. Sans clé, la surveillance continue avec les RPC publics.
- Les performances ne comptent que les swaps confirmés observés depuis le début du suivi. Les ventes partielles sont agrégées et une position n'est comptée comme clôturée qu'après sortie complète.
- Les PnL sont calculés séparément par actif de cotation (SOL, USDC, USDT ne sont jamais additionnés). Les montants réellement échangés intègrent le prix et les frais du swap; les frais réseau de transaction ne sont pas déduits.
- Les wallets découverts automatiquement restent des candidats à observer, pas des « Smart Money » réputés rentables. Un signal de convergence sur un token exige au moins trois positions clôturées observées sur plusieurs tokens pour chaque wallet retenu.
- L'historique reste partiel : les transactions antérieures au début du suivi, transferts, swaps non détectés et routes non couvertes peuvent manquer. Le score décrit les observations disponibles, pas la performance totale réelle ni l'identité d'une personne.

## Validation croisée Jupiter et paper trading

- En alternance, un scan sur deux, MEME RADAR envoie les cinq meilleurs candidats qualifiés à Jupiter Price API v3 (`https://api.jup.ag/price/v3`) en une seule requête bornée. L'accès keyless gratuit est utilisé par défaut; `JUPITER_API_KEY` est facultative et permet d'obtenir une limite supérieure.
- Le prix Jupiter est conservé avec son horodatage et son écart par rapport au prix DexScreener. L'absence de prix Jupiter n'est pas interprétée comme un prix nul.
- En alternance avec Price API, un seul meilleur candidat reçoit un devis de vente Jupiter Swap API V2 `/order` par scan, sans paramètre `taker`. Une seule requête Jupiter est donc envoyée au maximum par scan, afin de respecter le quota keyless. Le test utilise environ 100 USD de tokens, plafonnés à 0,5 % de la supply connue; le Dashboard affiche la route, les DEX et l'impact estimé. Il s'agit d'un devis instantané sans construction de transaction ni simulation on-chain : une route ne garantit pas qu'un swap sera exécuté, et aucune route ne prouve pas un honeypot.
- Le paper trading suit uniquement la sélection principale (maximum cinq positions). Une entrée exige un prix Jupiter datant de moins de cinq minutes et un écart de prix inférieur ou égal à 15 %.
- Hypothèses de simulation : 100 USD par position, frais de 0,3 % par côté, slippage estimé dynamiquement selon le montant de 100 USD et la liquidité observée (0,5 % de base, impact 1,5 × montant/liquidité, plafond 15 %), stop-loss de -25 %, objectif de +60 %, durée maximale de 24 heures. Les hypothèses sont explicites et ne représentent pas des fills garantis.
- Le registre est sauvegardé dans l'état JSON existant et limité aux 200 derniers trades clôturés. La page « Plus → Paper trading » affiche le capital simulé, les positions et les résultats; la simulation peut être mise en pause.
- Aucun wallet n'est signé et aucun swap n'est envoyé. Le paper trading est une mesure prospective; il ne remplace pas un backtest historique sans biais ni une validation sur un échantillon suffisant.

## Fraîcheur des preuves de marché et des swaps pool RPC

- Les valeurs de marché conservent leur horodatage **par métrique et par période** : volume M5/H1/H24, transactions M5/H1/H24 et variations de prix M5/H1/H24. Une réponse partielle qui ne contient que H24 ne rafraîchit jamais les valeurs H1 ou M5 précédemment conservées.
- Les anciennes valeurs peuvent rester visibles pour l'historique, mais elles sont neutralisées dans le scoring et les instantanés d'alerte dès que leur propre observation dépasse 15 minutes ou que son horodatage manque. Les champs inconnus restent `null`, jamais remplacés par un zéro artificiel.
- Le contrôle RPC des swaps est borné : rotation sur les 30 pools les mieux classés, trois pools inspectés au maximum par scan, six transactions `getTransaction` au maximum par pool, file de signatures et historique d'événements plafonnés. Les swaps doivent être confirmés par une instruction de programme reconnue et attribués à un signataire qui possède réellement le delta de token.
- Les signatures GeckoTerminal sont rapprochées des signatures RPC pour rattacher le volume USD observé. Les signatures sans wallet Gecko restent utilisables pour ce rapprochement, mais ne deviennent pas des acheteurs distincts sans preuve RPC.
- La demande vérifiée nécessaire au classement « Best » exige un échantillon Gecko récent d'au moins 20 trades, au moins cinq swaps de pool confirmés par RPC, au moins cinq acheteurs distincts signataires, une couverture de volume USD d'au moins 80 % et un flux acheteur USD supérieur ou égal au flux vendeur. Les swaps et leur dernier horodatage doivent rester dans la fenêtre de 15 minutes.
- Ces seuils servent uniquement à vérifier et qualifier les preuves : ils ne modifient ni le profil choisi dans le Dashboard, ni le score minimal de publication. Aucune transaction n'est signée ou envoyée.
