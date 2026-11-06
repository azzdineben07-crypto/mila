# Notre musée — multijoueur

## Ce qui a été ajouté

- Serveur Node.js intégré au projet et communication WebSocket (`/ws`).
- Salons privés à deux joueurs avec code d'invitation aléatoire.
- Ouverture du lien d'invitation : le navigateur rejoint automatiquement le salon.
- Présence et positions des avatars synchronisées, événements des mini-jeux relayés en temps réel.
- Noms invités, sans création de compte ni fournisseur d'authentification.
- Reconnexion automatique après une coupure réseau ; le serveur conserve l'état courant des mini-jeux et les salons pendant que le processus tourne.
- Sauvegarde locale de la position et de l'identifiant de session pour retrouver le joueur après rechargement.

## Lancer sur ton ordinateur

Node.js 18 ou plus récent est requis. Dans le dossier du projet :

```bash
npm start
```

Puis ouvre `http://localhost:3000`.

## Mettre le site en ligne

Il faut déployer **le dossier complet**, pas seulement le fichier HTML, sur un hébergeur qui exécute Node.js et autorise les WebSockets (par exemple Render, Railway ou un VPS).

- Runtime : Node.js 18+
- Build command : `npm install` (aucune dépendance externe n'est nécessaire dans cette version)
- Start command : `npm start`
- Le serveur écoute le port fourni par l'hébergeur via `PORT`.
- Il faut conserver le même domaine pour la page et le WebSocket `/ws`. En HTTPS, le navigateur utilise automatiquement `wss://`.

Une fois le domaine public disponible :

1. Azzdine ouvre le site, choisit son prénom et clique sur **Créer une partie**.
2. Il partage le lien affiché.
3. Mila ouvre ce lien depuis son téléphone ou son ordinateur. Le salon est rejoint automatiquement ; elle peut vérifier/choisir son prénom puis cliquer sur **Entrer dans le musée**.
4. Azzdine et Mila entrent dans le musée et ouvrent le même jeu depuis les cadres.

## À savoir pour l'exploitation

Les salons et états de mini-jeux sont conservés en mémoire du processus. Une coupure réseau ou un rechargement peut être repris tant que le serveur continue de tourner. Un redémarrage, une mise en veille ou un redéploiement efface les salons en mémoire. Pour une disponibilité permanente et plusieurs instances serveur, il faudra ajouter Redis ou une base de données partagée. Un hébergeur gratuit qui met le service en veille peut donc interrompre une partie.
