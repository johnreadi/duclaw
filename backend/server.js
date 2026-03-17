const express = require('express');
const cors = require('cors');
const Docker = require('dockerode');
const cron = require('node-cron');
const WebSocket = require('ws');
const http = require('http');
const axios = require('axios');
const path = require('path');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// Connexion Docker
const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

// Stockage des données de monitoring
const servicesStatus = new Map();
const diagnosticsHistory = [];

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
    // 1. Vérifier si le container existe et est en cours d'exécution
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

    // 2. Vérifier l'utilisation des ressources
    const stats = await container.stats({ stream: false });
    const memoryUsage = stats.memory_stats.usage / stats.memory_stats.limit * 100;
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuUsage = (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;

    diagnosis.checks.memoryUsage = memoryUsage.toFixed(2) + '%';
    diagnosis.checks.cpuUsage = cpuUsage.toFixed(2) + '%';

    if (memoryUsage > 90) {
      diagnosis.errors.push('Mémoire saturée: ' + memoryUsage.toFixed(2) + '%');
      diagnosis.recommendations.push('Augmenter la mémoire allouée au container');
      diagnosis.recommendations.push('Vérifier les fuites mémoire dans l\'application');
    }

    // 3. Vérifier la connectivité réseau
    const networks = containerInfo.NetworkSettings.Networks;
    diagnosis.checks.networks = Object.keys(networks);
    
    const dokployNetwork = networks['dokploy-network'];
    if (!dokployNetwork) {
      diagnosis.errors.push('Container non connecté au réseau dokploy-network');
      diagnosis.recommendations.push('Vérifier la configuration réseau du service dans Dokploy');
    } else {
      diagnosis.checks.ipAddress = dokployNetwork.IPAddress;
    }

    // 4. Vérifier les ports exposés
    const ports = containerInfo.NetworkSettings.Ports;
    diagnosis.checks.exposedPorts = ports;

    // 5. Récupérer les derniers logs
    const logs = await container.logs({ 
      tail: 50, 
      timestamps: true,
      stdout: true,
      stderr: true 
    });
    diagnosis.checks.recentLogs = logs.toString('utf-8').split('\n').slice(-10);

    // Analyser les logs pour des erreurs connues
    const logString = logs.toString('utf-8');
    if (logString.includes('ECONNREFUSED')) {
      diagnosis.errors.push('Erreur de connexion à la base de données ou service dépendant');
      diagnosis.recommendations.push('Vérifier que la base de données est accessible');
      diagnosis.recommendations.push('Vérifier les variables d\'environnement DATABASE_URL');
    }
    if (logString.includes('ENOMEM')) {
      diagnosis.errors.push('Mémoire insuffisante (ENOMEM)');
      diagnosis.recommendations.push('Augmenter la mémoire allouée au container');
    }
    if (logString.includes('ETIMEDOUT') || logString.includes('timeout')) {
      diagnosis.errors.push('Timeout détecté dans les logs');
      diagnosis.recommendations.push('Vérifier les connexions externes (API tierces, DB...)');
    }

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

app.get('/api/services', (req, res) => {
  res.json(Array.from(servicesStatus.values()));
});

app.get('/api/services/:name/diagnose', async (req, res) => {
  const { name } = req.params;
  const diagnosis = await diagnoseService(name);
  diagnosticsHistory.push(diagnosis);
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

app.post('/api/services/:name/restart', async (req, res) => {
  try {
    const { name } = req.params;
    const container = docker.getContainer(name);
    await container.restart();
    res.json({ message: 'Container redémarré avec succès' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/diagnostics/history', (req, res) => {
  res.json(diagnosticsHistory.slice(-50));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== WEBSOCKET ====================

wss.on('connection', (ws) => {
  console.log('Nouveau client connecté');
  ws.send(JSON.stringify({
    type: 'initial',
    data: Array.from(servicesStatus.values())
  }));
});

// ==================== CRON JOB ====================

// Vérifier les services toutes les 30 secondes
cron.schedule('*/30 * * * * *', checkAllServices);

// Premier check au démarrage
checkAllServices();

// ==================== DÉMARRAGE ====================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`DUCLAW Backend démarré sur le port ${PORT}`);
  console.log('Monitoring actif pour les services Dokploy');
});
