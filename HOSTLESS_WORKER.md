# Déploiement séparé du moteur MEME RADAR

Ce dépôt propose un point d'entrée Worker distinct du Dashboard :

- Dashboard actuel : `npm start` (FadeHost).
- Moteur seul : `npm run worker` (worker Hostless).

## Configuration du Worker

- Build command : `npm install`
- Start command : `npm run worker`
- Container port : laisser vide (le Worker n'ouvre aucun serveur HTTP).
- Instances : 1 uniquement.
- Variables : reprendre les clés de sources réellement configurées dans FadeHost, notamment `TELEGRAM_BOT_TOKEN` (ou `BOT_TOKEN`) et `TELEGRAM_CHAT_ID`, ainsi que les clés RPC/API nécessaires.
- `MEME_RADAR_WORKER_DATA_DIR` : chemin du disque persistant si Hostless en fournit un. Sans disque persistant, les données locales du Worker peuvent être perdues lors d'un redéploiement.

## Limite importante de cette première étape

Le Worker utilise son propre fichier `worker-store.json`. Il ne partage pas automatiquement les données du Dashboard FadeHost ni sa configuration de canaux Telegram. Ne le déploie pas en production en parallèle du scanner FadeHost : les deux moteurs pourraient analyser les mêmes tokens et envoyer des alertes en double.

Avant la bascule, il faut encore mettre en place une synchronisation authentifiée des données et des paramètres entre le Worker et le Dashboard, puis désactiver le scanner local de FadeHost de façon contrôlée. FadeHost reste la source de vérité tant que cette intégration n'est pas terminée.
