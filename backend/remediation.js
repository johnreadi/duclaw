const { saveEvent } = require('./database');

class RemediationEngine {
  constructor(docker, alertManager) {
    this.docker = docker;
    this.alertManager = alertManager;
    this.remediationHistory = new Map();
    this.circuitBreakers = new Map(); // Éviter les boucles de redémarrage
  }

  async evaluateAndRemediate(containerName, diagnosis) {
    const actions = [];
    const now = Date.now();

    // Vérifier le circuit breaker (éviter les actions trop fréquentes)
    const lastAction = this.circuitBreakers.get(containerName);
    if (lastAction && (now - lastAction) < 300000) { // 5 minutes
      console.log(`Circuit breaker actif pour ${containerName}`);
      return { skipped: true, reason: 'Circuit breaker actif' };
    }

    // Action 1: Container arrêté avec erreur de connexion DB
    if (!diagnosis.checks?.containerRunning && 
        diagnosis.errors?.some(e => e.includes('ECONNREFUSED') || e.includes('database'))) {
      actions.push({
        type: 'investigate_db',
        priority: 'high',
        automated: false,
        description: 'Vérifier la connectivité base de données'
      });
    }

    // Action 2: Container arrêté - Tentative de redémarrage
    else if (!diagnosis.checks?.containerRunning) {
      const restartCount = diagnosis.checks?.restartCount || 0;
      
      if (restartCount < 10) {
        actions.push({
          type: 'auto_restart',
          priority: 'high',
          automated: true,
          description: `Redémarrage automatique (restart count: ${restartCount})`
        });
        
        // Exécuter le redémarrage
        await this.restartContainer(containerName);
      } else {
        actions.push({
          type: 'manual_intervention',
          priority: 'critical',
          automated: false,
          description: 'Trop de redémarrages - Intervention manuelle requise'
        });
        
        // Envoyer alerte critique
        await this.alertManager.sendNotifications(containerName, {
          type: 'critical_failure',
          severity: 'critical',
          message: `${containerName} a dépassé le seuil de redémarrages. Intervention immédiate nécessaire.`
        });
      }
    }

    // Action 3: Mémoire saturée
    const memoryUsage = parseFloat(diagnosis.checks?.memoryUsage);
    if (memoryUsage > 95) {
      actions.push({
        type: 'memory_alert',
        priority: 'critical',
        automated: false,
        description: `Mémoire critique: ${memoryUsage}% - Risque de OOMKill`
      });
      
      // Alerte immédiate
      await this.alertManager.sendNotifications(containerName, {
        type: 'memory_critical',
        severity: 'critical',
        message: `${containerName} utilise ${memoryUsage}% de mémoire. Risque imminent de crash.`
      });
    } else if (memoryUsage > 85) {
      actions.push({
        type: 'memory_warning',
        priority: 'warning',
        automated: false,
        description: `Mémoire élevée: ${memoryUsage}%`
      });
    }

    // Action 4: Timeout détectés (502/504)
    if (diagnosis.errors?.some(e => e.includes('timeout') || e.includes('ETIMEDOUT'))) {
      actions.push({
        type: 'timeout_investigation',
        priority: 'high',
        automated: false,
        description: 'Timeouts détectés - Vérifier les dépendances externes'
      });
      
      // Si plusieurs timeouts consécutifs, suggérer un redémarrage
      const timeoutHistory = this.getTimeoutHistory(containerName);
      if (timeoutHistory.count > 5) {
        actions.push({
          type: 'suggested_restart',
          priority: 'medium',
          automated: false,
          description: 'Redémarrage suggéré après multiples timeouts'
        });
      }
    }

    // Action 5: Restart loop détecté
    if (diagnosis.checks?.restartCount > 5) {
      actions.push({
        type: 'restart_loop_detected',
        priority: 'critical',
        automated: false,
        description: 'Container en restart loop - Analyse des logs nécessaire'
      });
      
      // Récupérer les logs pour analyse
      const logs = await this.getContainerLogs(containerName, 50);
      const analysis = this.analyzeLogs(logs);
      
      actions.push({
        type: 'log_analysis',
        priority: 'info',
        automated: false,
        description: `Analyse: ${analysis.summary}`
      });
    }

    // Sauvegarder l'action
    if (actions.length > 0) {
      await saveEvent({
        container: containerName,
        eventType: 'remediation_evaluated',
        details: { actions, diagnosis: diagnosis.checks }
      });
      
      this.circuitBreakers.set(containerName, now);
    }

    return { actions, timestamp: new Date().toISOString() };
  }

  async restartContainer(containerName) {
    try {
      console.log(`Redémarrage automatique de ${containerName}...`);
      const container = this.docker.getContainer(containerName);
      await container.restart();
      
      await saveEvent({
        container: containerName,
        eventType: 'auto_restart',
        details: { success: true }
      });
      
      console.log(`${containerName} redémarré avec succès`);
      return true;
    } catch (error) {
      console.error(`Erreur lors du redémarrage de ${containerName}:`, error);
      
      await saveEvent({
        container: containerName,
        eventType: 'auto_restart_failed',
        details: { error: error.message }
      });
      
      return false;
    }
  }

  async getContainerLogs(containerName, tail = 50) {
    try {
      const container = this.docker.getContainer(containerName);
      const logs = await container.logs({ 
        tail, 
        timestamps: true,
        stdout: true,
        stderr: true 
      });
      return logs.toString('utf-8');
    } catch (error) {
      return '';
    }
  }

  analyzeLogs(logs) {
    const analysis = {
      summary: 'Aucun problème évident détecté',
      patterns: []
    };

    if (logs.includes('ENOMEM')) {
      analysis.patterns.push('OOM_KILL');
      analysis.summary = 'Processus tué par manque de mémoire';
    }
    if (logs.includes('ECONNREFUSED')) {
      analysis.patterns.push('DB_CONNECTION_FAILED');
      analysis.summary = 'Impossible de se connecter à la base de données';
    }
    if (logs.includes('Module not found') || logs.includes('Cannot find module')) {
      analysis.patterns.push('MISSING_DEPENDENCY');
      analysis.summary = 'Dépendance manquante';
    }
    if (logs.includes('Port already in use') || logs.includes('EADDRINUSE')) {
      analysis.patterns.push('PORT_CONFLICT');
      analysis.summary = 'Conflit de port';
    }
    if (logs.includes('SyntaxError')) {
      analysis.patterns.push('SYNTAX_ERROR');
      analysis.summary = 'Erreur de syntaxe dans le code';
    }

    return analysis;
  }

  getTimeoutHistory(containerName) {
    // Simplifié - en production, utiliser la base de données
    return { count: 0 };
  }

  // Protection contre les déploiements qui font tomber Dokploy
  async protectDokployInfrastructure() {
    try {
      const containers = await this.docker.listContainers();
      const criticalServices = ['dokploy', 'dokploy-traefik', 'dokploy-redis', 'dokploy-db'];
      
      for (const service of criticalServices) {
        const container = containers.find(c => 
          c.Names.some(n => n.includes(service))
        );
        
        if (!container) {
          await this.alertManager.sendNotifications(service, {
            type: 'critical_infrastructure_down',
            severity: 'critical',
            message: `Service critique ${service} est DOWN ! Risque pour toute l'infrastructure.`
          });
        }
      }
    } catch (error) {
      console.error('Erreur lors de la protection Dokploy:', error);
    }
  }
}

module.exports = RemediationEngine;
