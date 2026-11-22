# MEME RADAR — version gratuite

Dashboard privé de recherche de meme coins Solana. Le projet utilise uniquement des sources publiques gratuites : DexScreener et le RPC public Solana. Telegram est facultatif. Aucun fournisseur payant, aucune clé API payante, aucun wallet de trading et aucune signature de transaction.

## Fonctions disponibles sans payer

| Fonction | Source | Configuration |
|---|---|---|
| Découverte de tokens | DexScreener (profils récents et tokens boostés) | Rien |
| Prix, liquidité, volume, transactions, âge de la paire | DexScreener | Rien |
| Contrôles de mint/freeze authority | RPC public Solana | Rien |
| Concentration des 10 plus gros comptes détenteurs | RPC public Solana | Rien |
| Suivi de 10 wallets maximum | RPC public Solana, 5 transactions récentes par wallet, toutes les 10 minutes | Rien |
| Liens de sites et réseaux sociaux | Métadonnées DexScreener | Rien |
| Alertes Telegram | Telegram Bot API | Bot token + chat ID facultatifs |
| Dashboard et historique | Express + stockage JSON local | Variables d'accès + stockage persistant FadeHost |

**Limites importantes :**
- DexScreener ne recense pas instantanément tous les tokens créés sur Solana. La découverte dépend de ses flux publics (profils et boosts), ce n'est pas un flux exhaustif de chaque lancement.
- Le RPC public Solana est partagé et soumis à des limites de débit. Si FadeHost ou d'autres utilisateurs envoient trop de requêtes, certaines vérifications peuvent échouer temporairement. On peut renseigner un autre endpoint RPC public/gratuit dans `SOLANA_RPC_URL`, sans garantie de disponibilité.
- Les contrôles on-chain donnent des observations : ils ne prouvent pas que la liquidité est verrouillée, qu'un token est vendable ou qu'un contrat est sûr.
- Le pourcentage top 10 est calculé à partir des dix plus gros comptes de tokens renvoyés par le RPC. Les comptes peuvent appartenir au même détenteur (par exemple des pools ou des wallets liés) : ce n'est pas une analyse de bénéficiaires uniques.
- Smart Money suit uniquement les adresses que tu ajoutes. Ce n'est pas une liste automatique de traders rentables et les transactions récentes ne prouvent pas qu'un wallet est performant.
- Pas de mesure des mentions X, des tendances sociales ou des narratifs : ces fonctions nécessitent des données non disponibles dans cette version gratuite. Les liens sociaux publics restent visibles.
- Les scores sont des indicateurs heuristiques, pas des probabilités de hausse ni des conseils d'achat.

## Installation sur FadeHost

1. Connecte le dépôt GitHub ou mets à jour les fichiers de l'application.
2. Choisis **Node.js 20 ou supérieur**.
3. Dans le panneau FadeHost, configure les variables listées ci-dessous.
4. Lance l'installation des dépendances avec `npm install`.
5. Définis la commande de démarrage sur `npm start`.
6. Vérifie que le dossier `data/` est conservé lors des redémarrages et redéploiements.

## Variables FadeHost à configurer

### Obligatoires
- `DASHBOARD_ACCESS_CODE` : ton code privé, au moins 12 caractères.
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
- Le scanner crée `data/store.json` automatiquement. Le dossier `data/` doit être persistant sur FadeHost.
- Les variables secrètes doivent rester dans le panneau FadeHost, jamais dans le dépôt GitHub.
