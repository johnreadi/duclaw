# Déploiement de DUCLAW sur Dokploy

## Prérequis

1. Avoir Dokploy installé et configuré
2. Avoir un repository Git avec le code DUCLAW
3. Avoir accès au serveur Dokploy

## Étapes de déploiement

### 1. Préparer le repository

```bash
# Initialiser le repository Git (si ce n'est pas déjà fait)
git init
git add .
git commit -m "Initial commit: DUCLAW monitoring tool"

# Pousser sur votre remote (GitHub, GitLab, etc.)
git remote add origin <votre-repo-url>
git push -u origin main
```

### 2. Créer l'application dans Dokploy

1. Connectez-vous à votre interface Dokploy
2. Cliquez sur "Create Application"
3. Choisissez "Docker Compose"
4. Sélectionnez votre repository Git
5. Spécifiez le chemin du fichier docker-compose.yml

### 3. Configuration importante

#### Volumes Docker

DUCLAW a besoin d'accéder au socket Docker pour monitorer les containers. Dans la configuration Dokploy, assurez-vous que le volume est correctement monté :

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

#### Réseau

Le fichier docker-compose.yml utilise le réseau externe `dokploy-network`. Assurez-vous que ce réseau existe :

```bash
# Sur le serveur Dokploy
docker network ls | grep dokploy-network

# Si le réseau n'existe pas, créez-le :
docker network create dokploy-network
```

### 4. Variables d'environnement

Créez un fichier `.env` dans Dokploy avec les variables suivantes :

```env
PORT=3000
CHECK_INTERVAL=30000
```

### 5. Déployer

1. Cliquez sur "Deploy" dans Dokploy
2. Attendez que le build et le déploiement se terminent
3. Vérifiez les logs pour vous assurer que tout fonctionne

### 6. Configurer le domaine

1. Dans Dokploy, allez dans les paramètres de l'application
2. Ajoutez un domaine (ex: `duclaw.votredomaine.com`)
3. Dokploy configurera automatiquement Traefik pour router le trafic

### 7. Vérifier le fonctionnement

Accédez à votre domaine et vous devriez voir le dashboard DUCLAW avec :
- La liste de tous vos services Dokploy
- Leur statut en temps réel
- Les métriques CPU/Mémoire
- Les erreurs détectées
- Les recommandations

## Dépannage

### Problème : "Cannot connect to Docker daemon"

Vérifiez que le volume Docker socket est correctement monté :
```bash
# Dans le container duclaw-backend
docker exec -it duclaw-backend ls -la /var/run/docker.sock
```

### Problème : "Network not found"

Assurez-vous que le réseau `dokploy-network` existe :
```bash
docker network create dokploy-network
```

Puis redéployez l'application.

### Problème : Les services n'apparaissent pas

Vérifiez les logs du backend :
```bash
docker logs duclaw-backend
```

Le backend doit avoir accès au socket Docker pour lister les containers.

## Utilisation

### Dashboard

Le dashboard affiche :
- **Nombre total de services** : Tous les containers détectés
- **Services en cours** : Containers en état "running"
- **Erreurs** : Services avec des problèmes détectés
- **Restart loops** : Services qui redémarrent en boucle

### Diagnostic

Cliquez sur un service pour voir :
- Son statut détaillé
- L'utilisation CPU/Mémoire
- Son adresse IP sur le réseau
- Les erreurs détectées
- Les recommandations pour résoudre les problèmes
- Les logs récents

### Actions

Pour chaque service, vous pouvez :
- **Voir les logs** : Affiche les 100 dernières lignes de logs
- **Redémarrer** : Redémarre le container (utile en cas de problème)

## Mises à jour

Pour mettre à jour DUCLAW :

1. Modifiez le code localement
2. Commit et push sur Git
3. Dokploy détectera automatiquement le changement et redéploiera

Ou déclenchez manuellement un redeploy dans l'interface Dokploy.
