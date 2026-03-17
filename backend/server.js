const express = require('express');
const cors = require('cors');
const Docker = require('dockerode');
const cron = require('node-cron');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

require('dotenv').config();

// Import des modules
const { initDatabase, saveMetric, getMetricsHistory, getActiveAlerts, acknowledgeAlert, saveEvent, pool } = require('./database');
const AlertManager = require('./alerts');
const SSLMonitor = require('./ssl-monitor');
const AuthManager = require('./auth');
const RemediationEngine = require('./remediation');
const SecurityMonitor = require('./security-monitor');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// Connexion Docker
let docker;
try {
  docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });
  console.log('Connexion Docker établie');
} catch (error) {
  console.error('Erreur connexion Docker:', error);
  process.exit(1);
}

// Initialisation des managers
const alertManager = new AlertManager();
const sslMonitor = new SSLMonitor();
const authManager = new AuthManager();
const remediationEngine = new RemediationEngine(docker, alertManager);
const securityMonitor = new SecurityMonitor(alertManager);

// Stockage des données de monitoring
const servicesStatus = new Map();

// ==================== FONCTIONS DE DIAGNOSTIC ====================

async function diagnoseService(containerName) {
  const diagnosis = {
    container: containerName,
    timestamp: new Date().toISOString(),
    checks: {},
    errors: [],
    recommendations: []
  };

  try {
    const container = docker.getContainer(containerName);
    const containerInfo = await container.inspect();
    
    diagnosis.checks.containerRunning = containerInfo.State.Running;
    diagnosis.checks.containerStatus = containerInfo.State.Status;
    diagnosis.checks.health = containerInfo.State.Health?.Status || 'N/A';
    diagnosis.checks.restartCount = containerInfo.RestartCount;
    diagnosis.checks.exitCode = containerInfo.State.ExitCode;

    if (!containerInfo.State.Running) {
      diagnosis.errors.push('Container arrêté');
      diagnosis.recommendations.push('Vérifier les logs du container: docker logs ' + containerName);
      diagnosis.recommendations.push('Vérifier si le container redémarre en boucle (restart loop)');
    }

    if (containerInfo.RestartCount > 5) {
      diagnosis.errors.push('Container en restart loop');
      diagnosis.recommendations.push('Investiguer la cause du crash (mémoire, dépendances...)');
    }

    // Ressources
    let memoryUsage = 0;
    let cpuUsage = 0;
    let memoryLimit = 0;
    try {
      const stats = await container.stats({ stream: false });
      memoryLimit = stats.memory_stats?.limit || 0;
      const memUsage = stats.memory_stats?.usage || 0;
      memoryUsage = memoryLimit > 0 ? (memUsage / memoryLimit * 100) : 0;
      const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage || 0) - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
      const systemDelta = (stats.cpu_stats?.system_cpu_usage || 0) - (stats.precpu_stats?.system_cpu_usage || 0);
      const numCpus = stats.cpu_stats?.online_cpus || 1;
      cpuUsage = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;

      diagnosis.checks.memoryUsage = isFinite(memoryUsage) ? memoryUsage.toFixed(2) : '0.00';
      diagnosis.checks.cpuUsage = isFinite(cpuUsage) ? cpuUsage.toFixed(2) : '0.00';
      diagnosis.checks.memoryLimit = memoryLimit;

      if (memoryUsage > 90) {
        diagnosis.errors.push('Mémoire saturée: ' + memoryUsage.toFixed(2) + '%');
        diagnosis.recommendations.push('Augmenter la mémoire allouée au container');
        diagnosis.recommendations.push('Vérifier les fuites mémoire dans l\'application');
      }
    } catch (statsError) {
      diagnosis.checks.memoryUsage = 'N/A';
      diagnosis.checks.cpuUsage = 'N/A';
    }

    // Réseau
    const networks = containerInfo.NetworkSettings.Networks;
    diagnosis.checks.networks = Object.keys(networks);
    
    // Vérifier si connecté au réseau dokploy (pour les apps Dokploy)
    const dokployNetwork = networks['dokploy-network'];
    if (dokployNetwork) {
      diagnosis.checks.ipAddress = dokployNetwork.IPAddress;
    } else {
      // Chercher une autre IP si pas sur dokploy-network
      const firstNetwork = Object.values(networks)[0];
      if (firstNetwork) {
        diagnosis.checks.ipAddress = firstNetwork.IPAddress;
      }
    }

    // Logs
    let logString = '';
    try {
      const logs = await container.logs({ 
        tail: 50, 
        timestamps: true,
        stdout: true,
        stderr: true 
      });
      // Nettoyer les caractères non-UTF8 et les séquences d'échappement invalides
      logString = logs.toString('utf-8')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // caractères de contrôle
        .replace(/\\u[0-9a-fA-F]{0,3}(?![0-9a-fA-F])/g, '?') // Unicode incomplets
        .replace(/\\x[0-9a-fA-F]{0,1}(?![0-9a-fA-F])/g, '?'); // Hex incomplets
      diagnosis.checks.recentLogs = logString.split('\n').slice(-10);
    } catch (logError) {
      diagnosis.checks.recentLogs = [`Logs non disponibles: ${logError.message}`];
    }

    // Analyser les logs selon le type de container
    const isProxy = containerName.toLowerCase().includes('traefik');
    const isDatabase = /redis|postgres|mysql|mongo|mariadb/.test(containerName.toLowerCase());

    if (logString.includes('ECONNREFUSED')) {
      diagnosis.errors.push('Erreur de connexion à la base de données ou service dépendant');
      diagnosis.recommendations.push('Vérifier que la base de données est accessible');
    }
    if (logString.includes('ENOMEM')) {
      diagnosis.errors.push('Mémoire insuffisante (ENOMEM)');
      diagnosis.recommendations.push('Augmenter la mémoire allouée au container');
    }
    // Timeouts : ignorés pour Traefik (normal qu'il rapporte des timeouts d'autres apps)
    if (!isProxy && (logString.includes('ETIMEDOUT') || logString.includes('timeout'))) {
      diagnosis.errors.push('Timeout détecté dans les logs');
      diagnosis.recommendations.push('Vérifier les connexions externes (API tierces, DB...)');
    }
    // Traefik : détecter les vrais problèmes
    if (isProxy) {
      const timeoutCount = (logString.match(/timeout/gi) || []).length;
      if (timeoutCount > 20) {
        diagnosis.errors.push(`Traefik: ${timeoutCount} timeouts détectés - plusieurs services en difficulté`);
        diagnosis.recommendations.push('Vérifier les services qui génèrent le plus de timeouts dans les logs Traefik');
      }
      if (logString.includes('dial tcp') && logString.includes('connection refused')) {
        diagnosis.errors.push('Traefik: service(s) inaccessible(s)');
        diagnosis.recommendations.push('Vérifier les containers cibles qui ne répondent plus');
      }
    }

    // Sauvegarder les métriques
    try {
      await saveMetric({
        container: containerName,
        cpuUsage: isFinite(cpuUsage) ? cpuUsage.toFixed(2) : '0.00',
        memoryUsage: isFinite(memoryUsage) ? memoryUsage.toFixed(2) : '0.00',
        memoryLimit: memoryLimit,
        status: containerInfo.State.Status,
        restartCount: containerInfo.RestartCount,
        healthStatus: containerInfo.State.Health?.Status || 'N/A'
      });
    } catch (metricError) {
      // Ne pas bloquer le diagnostic si la sauvegarde échoue
    }

    // Vérifier les alertes
    await alertManager.checkAndAlert(containerName, diagnosis);

    // Évaluer et appliquer la remédiation automatique
    const remediation = await remediationEngine.evaluateAndRemediate(containerName, diagnosis);
    diagnosis.remediation = remediation;

  } catch (error) {
    diagnosis.errors.push('Erreur lors du diagnostic: ' + error.message);
  }

  return diagnosis;
}

async function checkAllServices() {
  try {
    console.log('Récupération des containers...');
    const containers = await docker.listContainers({ all: true });
    console.log(`${containers.length} containers trouvés`);
    
    // Exclure uniquement les containers système de Docker et DUCLAW lui-même
    const excludedContainers = ['duclaw-backend', 'duclaw-frontend', 'duclaw-db'];
    
    const monitoredContainers = containers.filter(c => {
      const name = c.Names[0].replace('/', '');
      return !excludedContainers.includes(name);
    });
    
    console.log(`${monitoredContainers.length} containers à monitorer`);

    for (const containerInfo of monitoredContainers) {
      const containerName = containerInfo.Names[0].replace('/', '');
      try {
        const diagnosis = await diagnoseService(containerName);
        servicesStatus.set(containerName, diagnosis);
      } catch (error) {
        console.error(`Erreur diagnostic ${containerName}:`, error.message);
      }
    }

    // Notifier les clients WebSocket
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'statusUpdate',
          data: Array.from(servicesStatus.values())
        }));
      }
    });

  } catch (error) {
    console.error('Erreur lors du check des services:', error);
  }
}

// ==================== ROUTES API ====================

// Routes publiques
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes d'authentification
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await authManager.login(username, password);
    res.json(result);
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

// Routes protégées
app.use('/api', AuthManager.middleware);

// Services
app.get('/api/services', (req, res) => {
  res.json(Array.from(servicesStatus.values()));
});

app.get('/api/services/:name/diagnose', async (req, res) => {
  const { name } = req.params;
  const diagnosis = await diagnoseService(name);
  res.json(diagnosis);
});

app.get('/api/services/:name/logs', async (req, res) => {
  try {
    const { name } = req.params;
    const { tail = 100 } = req.query;
    const container = docker.getContainer(name);
    const logs = await container.logs({ 
      tail: parseInt(tail), 
      timestamps: true,
      stdout: true,
      stderr: true 
    });
    res.json({ logs: logs.toString('utf-8') });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/services/:name/metrics', async (req, res) => {
  try {
    const { name } = req.params;
    const { hours = 24 } = req.query;
    const metrics = await getMetricsHistory(name, parseInt(hours));
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/services/:name/restart', async (req, res) => {
  try {
    const { name } = req.params;
    const container = docker.getContainer(name);
    await container.restart();
    await saveEvent({ container: name, eventType: 'restart', details: { user: req.user?.username } });
    res.json({ message: 'Container redémarré avec succès' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/services/:name/start', async (req, res) => {
  try {
    const { name } = req.params;
    const container = docker.getContainer(name);
    await container.start();
    await saveEvent({ container: name, eventType: 'start', details: { user: req.user?.username } });
    res.json({ message: 'Container démarré avec succès' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/services/:name/stop', async (req, res) => {
  try {
    const { name } = req.params;
    const container = docker.getContainer(name);
    await container.stop();
    await saveEvent({ container: name, eventType: 'stop', details: { user: req.user?.username } });
    res.json({ message: 'Container arrêté avec succès' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/services/:name/delete', async (req, res) => {
  try {
    const { name } = req.params;
    const container = docker.getContainer(name);
    // Arrêter d'abord si en cours
    const info = await container.inspect();
    if (info.State.Running) await container.stop();
    await container.remove({ force: true });
    servicesStatus.delete(name);
    await saveEvent({ container: name, eventType: 'delete', details: { user: req.user?.username } });
    res.json({ message: 'Container supprimé avec succès' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Alertes
app.get('/api/alerts', async (req, res) => {
  try {
    const alerts = await getActiveAlerts();
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/alerts/:id/acknowledge', async (req, res) => {
  try {
    const { id } = req.params;
    await acknowledgeAlert(id);
    res.json({ message: 'Alerte acquittée' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/alerts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM alerts WHERE id = $1', [id]);
    res.json({ message: 'Alerte supprimée' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/alerts', async (req, res) => {
  try {
    await pool.query('DELETE FROM alerts WHERE acknowledged = false');
    res.json({ message: 'Toutes les alertes supprimées' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/alerts/active', (req, res) => {
  res.json(alertManager.getActiveAlertsList());
});

// SSL Certificates
app.get('/api/ssl', async (req, res) => {
  try {
    const certs = await sslMonitor.checkAllCertificates();
    res.json(certs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remédiation
app.get('/api/services/:name/remediation', async (req, res) => {
  try {
    const { name } = req.params;
    const diagnosis = await diagnoseService(name);
    const remediation = await remediationEngine.evaluateAndRemediate(name, diagnosis);
    res.json(remediation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/services/:name/remediate', async (req, res) => {
  try {
    const { name } = req.params;
    const { action } = req.body;
    
    let result;
    switch (action) {
      case 'restart':
        result = await remediationEngine.restartContainer(name);
        break;
      default:
        return res.status(400).json({ error: 'Action non supportée' });
    }
    
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/ssl/expiring', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const certs = await sslMonitor.getExpiringCertificates(parseInt(days));
    res.json(certs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stats système VPS
app.get('/api/system/stats', async (req, res) => {
  try {
    const stats = await securityMonitor.getSystemStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/system/cleanup', AuthManager.requireAdmin, async (req, res) => {
  try {
    const result = await securityMonitor.autoCleanDisk();
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Gestion des utilisateurs (admin uniquement)
app.get('/api/users', AuthManager.requireAdmin, async (req, res) => {
  try {
    const users = await authManager.getAllUsers();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users', AuthManager.requireAdmin, async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    const user = await authManager.createUser(username, email, password, role);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== WEBSOCKET ====================

wss.on('connection', (ws) => {
  console.log('Nouveau client connecté');
  ws.send(JSON.stringify({
    type: 'initial',
    data: Array.from(servicesStatus.values())
  }));
});

// ==================== CRON JOBS ====================

// Vérifier les services toutes les 30 secondes
cron.schedule('*/30 * * * * *', checkAllServices);

// Vérifier les certificats SSL une fois par jour
cron.schedule('0 0 * * *', async () => {
  console.log('Vérification des certificats SSL...');
  await sslMonitor.checkAllCertificates();
});

// Protection de l'infrastructure Dokploy toutes les 2 minutes
cron.schedule('*/2 * * * *', async () => {
  await remediationEngine.protectDokployInfrastructure();
});

// Protection de tous les containers (y compris applications utilisateur)
cron.schedule('*/5 * * * *', async () => {
  console.log('Protection automatique de tous les containers...');
  for (const [containerName, diagnosis] of servicesStatus.entries()) {
    // Appliquer la remédiation pour tous les containers en échec
    if (!diagnosis.checks?.containerRunning || diagnosis.errors?.length > 0) {
      await remediationEngine.evaluateAndRemediate(containerName, diagnosis);
    }
  }
});

// Monitoring sécurité VPS toutes les 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('Vérification sécurité VPS...');
  await securityMonitor.checkSecurityThreats();
});

// Monitoring disque et mémoire toutes les 2 minutes
cron.schedule('*/2 * * * *', async () => {
  await securityMonitor.checkDiskSpace();
  await securityMonitor.checkMemoryUsage();
});

// ==================== INITIALISATION ====================

async function init() {
  // Attente de la base de données avec retry
  let dbReady = false;
  for (let i = 0; i < 10; i++) {
    try {
      await initDatabase();
      console.log('Base de données initialisée');
      dbReady = true;
      break;
    } catch (error) {
      console.warn(`DB non prête (tentative ${i + 1}/10): ${error.message}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  if (!dbReady) {
    console.error('Impossible de se connecter à la base de données après 10 tentatives');
    // Continuer sans DB en mode dégradé plutôt que crasher
  }

  // Créer l'admin par défaut (si DB disponible)
  if (dbReady) {
    try {
      await authManager.createDefaultAdmin();
    } catch (error) {
      console.warn('Impossible de créer l\'admin par défaut:', error.message);
    }
  }

  // Premier check des services (sans crash si Docker inaccessible)
  try {
    await checkAllServices();
  } catch (error) {
    console.warn('Avertissement lors du premier check:', error.message);
  }

  // Démarrer le serveur
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`DUCLAW Backend démarré sur le port ${PORT}`);
    console.log('Monitoring actif pour les services Dokploy');
  });
}

init().catch(error => {
  console.error('Erreur fatale:', error);
  process.exit(1);
});
