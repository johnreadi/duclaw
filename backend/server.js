const express = require('express');
const cors = require('cors');
const Docker = require('dockerode');
const cron = require('node-cron');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

require('dotenv').config();

// Import des modules
const { initDatabase, saveMetric, getMetricsHistory, getActiveAlerts, acknowledgeAlert, saveEvent } = require('./database');
const AlertManager = require('./alerts');
const SSLMonitor = require('./ssl-monitor');
const AuthManager = require('./auth');
const RemediationEngine = require('./remediation');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// Connexion Docker
const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

// Initialisation des managers
const alertManager = new AlertManager();
const sslMonitor = new SSLMonitor();
const authManager = new AuthManager();
const remediationEngine = new RemediationEngine(docker, alertManager);

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
    const stats = await container.stats({ stream: false });
    const memoryUsage = stats.memory_stats.usage / stats.memory_stats.limit * 100;
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuUsage = (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;

    diagnosis.checks.memoryUsage = memoryUsage.toFixed(2);
    diagnosis.checks.cpuUsage = cpuUsage.toFixed(2);
    diagnosis.checks.memoryLimit = stats.memory_stats.limit;

    if (memoryUsage > 90) {
      diagnosis.errors.push('Mémoire saturée: ' + memoryUsage.toFixed(2) + '%');
      diagnosis.recommendations.push('Augmenter la mémoire allouée au container');
      diagnosis.recommendations.push('Vérifier les fuites mémoire dans l\'application');
    }

    // Réseau
    const networks = containerInfo.NetworkSettings.Networks;
    diagnosis.checks.networks = Object.keys(networks);
    
    const dokployNetwork = networks['dokploy-network'];
    if (!dokployNetwork) {
      diagnosis.errors.push('Container non connecté au réseau dokploy-network');
      diagnosis.recommendations.push('Vérifier la configuration réseau du service dans Dokploy');
    } else {
      diagnosis.checks.ipAddress = dokployNetwork.IPAddress;
    }

    // Logs
    const logs = await container.logs({ 
      tail: 50, 
      timestamps: true,
      stdout: true,
      stderr: true 
    });
    diagnosis.checks.recentLogs = logs.toString('utf-8').split('\n').slice(-10);

    // Analyser les logs
    const logString = logs.toString('utf-8');
    if (logString.includes('ECONNREFUSED')) {
      diagnosis.errors.push('Erreur de connexion à la base de données ou service dépendant');
      diagnosis.recommendations.push('Vérifier que la base de données est accessible');
    }
    if (logString.includes('ENOMEM')) {
      diagnosis.errors.push('Mémoire insuffisante (ENOMEM)');
      diagnosis.recommendations.push('Augmenter la mémoire allouée au container');
    }
    if (logString.includes('ETIMEDOUT') || logString.includes('timeout')) {
      diagnosis.errors.push('Timeout détecté dans les logs');
      diagnosis.recommendations.push('Vérifier les connexions externes (API tierces, DB...)');
    }

    // Sauvegarder les métriques
    await saveMetric({
      container: containerName,
      cpuUsage: cpuUsage.toFixed(2),
      memoryUsage: memoryUsage.toFixed(2),
      memoryLimit: stats.memory_stats.limit,
      status: containerInfo.State.Status,
      restartCount: containerInfo.RestartCount,
      healthStatus: containerInfo.State.Health?.Status || 'N/A'
    });

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
    const containers = await docker.listContainers({ all: true });
    const dokployContainers = containers.filter(c => 
      c.Names.some(name => name.includes('dokploy') || name.includes('traefik'))
    );

    for (const containerInfo of dokployContainers) {
      const containerName = containerInfo.Names[0].replace('/', '');
      const diagnosis = await diagnoseService(containerName);
      servicesStatus.set(containerName, diagnosis);
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
    
    // Sauvegarder l'événement
    await saveEvent({
      container: name,
      eventType: 'restart',
      details: { user: req.user.username }
    });
    
    res.json({ message: 'Container redémarré avec succès' });
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

// ==================== INITIALISATION ====================

async function init() {
  try {
    // Initialiser la base de données
    await initDatabase();
    console.log('Base de données initialisée');

    // Créer l'admin par défaut
    await authManager.createDefaultAdmin();

    // Premier check des services
    await checkAllServices();

    // Démarrer le serveur
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`DUCLAW Backend démarré sur le port ${PORT}`);
      console.log('Monitoring actif pour les services Dokploy');
    });
  } catch (error) {
    console.error('Erreur lors de l\'initialisation:', error);
    process.exit(1);
  }
}

init();
