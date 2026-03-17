const { saveEvent, saveAlert } = require('./database');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class SecurityMonitor {
  constructor(alertManager) {
    this.alertManager = alertManager;
    this.failedAttempts = new Map(); // Tracker les tentatives échouées
    this.blockedIPs = new Set();
    this.attackPatterns = new Map();
  }

  // ==================== MONITORING DISQUE ====================

  async checkDiskSpace() {
    try {
      const { stdout } = await execPromise('df -h /');
      const lines = stdout.trim().split('\n');
      const dataLine = lines[1]; // Ligne des données (skip header)
      const parts = dataLine.split(/\s+/);
      
      const usage = parseInt(parts[4].replace('%', ''));
      const total = parts[1];
      const used = parts[2];
      const available = parts[3];

      const result = {
        usage,
        total,
        used,
        available,
        timestamp: new Date().toISOString()
      };

      // Actions selon le pourcentage d'utilisation
      if (usage > 95) {
        await this.handleCriticalDiskSpace(result);
      } else if (usage > 90) {
        await this.handleHighDiskSpace(result);
      } else if (usage > 80) {
        await this.handleWarningDiskSpace(result);
      }

      return result;
    } catch (error) {
      console.error('Erreur lors de la vérification du disque:', error);
      return null;
    }
  }

  async handleCriticalDiskSpace(info) {
    // Nettoyage automatique
    const cleaned = await this.autoCleanDisk();
    
    await this.alertManager.sendNotifications('system', {
      type: 'disk_critical',
      severity: 'critical',
      message: `DISQUE CRITIQUE: ${info.usage}% utilisé (${info.used}/${info.total}). Nettoyage auto: ${cleaned ? 'Réussi' : 'Échec'}`
    });

    await saveAlert({
      container: 'system',
      alertType: 'disk_space_critical',
      severity: 'critical',
      message: `Espace disque critique: ${info.usage}%`
    });
  }

  async handleHighDiskSpace(info) {
    await this.alertManager.sendNotifications('system', {
      type: 'disk_high',
      severity: 'warning',
      message: `DISQUE ÉLEVÉ: ${info.usage}% utilisé (${info.used}/${info.total}). Nettoyage recommandé.`
    });
  }

  async handleWarningDiskSpace(info) {
    console.log(`Espace disque à ${info.usage}% - Surveillance`);
  }

  async autoCleanDisk() {
    try {
      console.log('Nettoyage automatique du disque...');
      
      // Nettoyer les logs vieux (> 7 jours)
      await execPromise('find /var/log -name "*.log" -mtime +7 -delete 2>/dev/null || true');
      
      // Nettoyer les containers Docker arrêtés
      await execPromise('docker container prune -f 2>/dev/null || true');
      
      // Nettoyer les images Docker non utilisées
      await execPromise('docker image prune -af --filter "until=168h" 2>/dev/null || true');
      
      // Nettoyer les volumes non utilisés
      await execPromise('docker volume prune -f 2>/dev/null || true');
      
      // Nettoyer le cache apt
      await execPromise('apt-get clean 2>/dev/null || true');
      
      await saveEvent({
        container: 'system',
        eventType: 'disk_cleanup',
        details: { automated: true }
      });
      
      return true;
    } catch (error) {
      console.error('Erreur lors du nettoyage:', error);
      return false;
    }
  }

  // ==================== MONITORING MÉMOIRE ====================

  async checkMemoryUsage() {
    try {
      const { stdout } = await execPromise('free -m');
      const lines = stdout.trim().split('\n');
      const memLine = lines[1]; // Ligne Mem
      const parts = memLine.split(/\s+/);
      
      const total = parseInt(parts[1]);
      const used = parseInt(parts[2]);
      const free = parseInt(parts[3]);
      const available = parseInt(parts[6]);
      const usagePercent = Math.round((used / total) * 100);

      const result = {
        total,
        used,
        free,
        available,
        usagePercent,
        timestamp: new Date().toISOString()
      };

      // Actions selon l'utilisation
      if (usagePercent > 95) {
        await this.handleCriticalMemory(result);
      } else if (usagePercent > 90) {
        await this.handleHighMemory(result);
      } else if (usagePercent > 85) {
        await this.handleWarningMemory(result);
      }

      return result;
    } catch (error) {
      console.error('Erreur lors de la vérification mémoire:', error);
      return null;
    }
  }

  async handleCriticalMemory(info) {
    // Tuer les processus gourmands
    const killed = await this.killHeavyProcesses();
    
    await this.alertManager.sendNotifications('system', {
      type: 'memory_critical',
      severity: 'critical',
      message: `MÉMOIRE CRITIQUE: ${info.usagePercent}% utilisée (${info.used}MB/${info.total}MB). Processus tués: ${killed}`
    });

    await saveAlert({
      container: 'system',
      alertType: 'memory_critical',
      severity: 'critical',
      message: `Mémoire critique: ${info.usagePercent}%`
    });
  }

  async handleHighMemory(info) {
    await this.alertManager.sendNotifications('system', {
      type: 'memory_high',
      severity: 'warning',
      message: `MÉMOIRE ÉLEVÉE: ${info.usagePercent}% utilisée (${info.used}MB/${info.total}MB)`
    });
  }

  async handleWarningMemory(info) {
    console.log(`Mémoire à ${info.usagePercent}% - Surveillance`);
  }

  async killHeavyProcesses() {
    try {
      // Trouver les processus utilisant plus de 500MB de mémoire (non-système)
      const { stdout } = await execPromise(
        "ps aux --sort=-%mem | awk '$6 > 500000 && $11 !~ /^\\[/ {print $2, $6, $11}' | head -5"
      );
      
      const processes = stdout.trim().split('\n').filter(line => line);
      let killed = 0;
      
      for (const proc of processes) {
        const [pid, mem, name] = proc.split(' ');
        if (pid && !name.includes('docker') && !name.includes('systemd')) {
          try {
            await execPromise(`kill -9 ${pid}`);
            console.log(`Processus tué: ${name} (${pid}) - ${Math.round(mem/1024)}MB`);
            killed++;
          } catch (e) {
            // Ignorer les erreurs de kill
          }
        }
      }
      
      await saveEvent({
        container: 'system',
        eventType: 'memory_cleanup',
        details: { processesKilled: killed }
      });
      
      return killed;
    } catch (error) {
      console.error('Erreur lors du kill des processus:', error);
      return 0;
    }
  }

  // ==================== SÉCURITÉ - DÉTECTION ATTAQUES ====================

  async checkSecurityThreats() {
    await Promise.all([
      this.checkFailedSSHAttempts(),
      this.checkDDoSAttempts(),
      this.checkPortScans(),
      this.checkSuspiciousProcesses()
    ]);
  }

  async checkFailedSSHAttempts() {
    try {
      // Vérifier les échecs de connexion SSH dans les dernières 10 minutes
      const { stdout } = await execPromise(
        "grep 'Failed password' /var/log/auth.log 2>/dev/null | tail -100 || echo ''"
      );
      
      const attempts = stdout.trim().split('\n').filter(line => line);
      const ipAttempts = new Map();
      
      for (const attempt of attempts) {
        const ipMatch = attempt.match(/from\s+(\d+\.\d+\.\d+\.\d+)/);
        if (ipMatch) {
          const ip = ipMatch[1];
          ipAttempts.set(ip, (ipAttempts.get(ip) || 0) + 1);
        }
      }
      
      // Bloquer les IPs avec plus de 5 tentatives échouées
      for (const [ip, count] of ipAttempts) {
        if (count >= 5 && !this.blockedIPs.has(ip)) {
          await this.blockIP(ip, `SSH brute force (${count} tentatives)`);
        }
      }
    } catch (error) {
      // auth.log peut ne pas exister
    }
  }

  async checkDDoSAttempts() {
    try {
      // Vérifier les connexions actives par IP
      const { stdout } = await execPromise(
        "netstat -ntu | awk '{print $5}' | cut -d: -f1 | sort | uniq -c | sort -rn | head -10"
      );
      
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const [count, ip] = line.trim().split(/\s+/);
        const numConnections = parseInt(count);
        
        // Plus de 100 connexions depuis une IP = suspect
        if (numConnections > 100 && ip !== '127.0.0.1' && !ip.includes('172.')) {
          await this.blockIP(ip, `DDoS suspect (${numConnections} connexions)`);
        }
      }
    } catch (error) {
      console.error('Erreur check DDoS:', error);
    }
  }

  async checkPortScans() {
    try {
      // Utiliser netstat pour détecter les scans de ports
      const { stdout } = await execPromise(
        "netstat -nt | grep SYN_RECV | wc -l"
      );
      
      const synRecvCount = parseInt(stdout.trim());
      if (synRecvCount > 50) {
        await this.alertManager.sendNotifications('system', {
          type: 'port_scan_detected',
          severity: 'warning',
          message: `Scan de port détecté: ${synRecvCount} connexions SYN_RECV`
        });
      }
    } catch (error) {
      // Ignorer
    }
  }

  async checkSuspiciousProcesses() {
    try {
      // Chercher des processus suspects (mining, reverse shells, etc.)
      const suspiciousPatterns = ['xmrig', 'minerd', 'stratum', 'reverse', 'nc -e', 'ncat -e'];
      
      const { stdout } = await execPromise('ps aux');
      const lines = stdout.split('\n');
      
      for (const line of lines) {
        for (const pattern of suspiciousPatterns) {
          if (line.toLowerCase().includes(pattern)) {
            const parts = line.split(/\s+/);
            const pid = parts[1];
            const user = parts[0];
            
            await this.alertManager.sendNotifications('system', {
              type: 'suspicious_process',
              severity: 'critical',
              message: `Processus suspect détecté: ${pattern} (PID: ${pid}, User: ${user})`
            });
            
            // Tuer le processus
            try {
              await execPromise(`kill -9 ${pid}`);
              console.log(`Processus suspect tué: ${pid}`);
            } catch (e) {}
          }
        }
      }
    } catch (error) {
      console.error('Erreur check processus:', error);
    }
  }

  async blockIP(ip, reason) {
    try {
      if (this.blockedIPs.has(ip)) return;
      
      // Bloquer avec iptables
      await execPromise(`iptables -A INPUT -s ${ip} -j DROP`);
      this.blockedIPs.add(ip);
      
      await this.alertManager.sendNotifications('system', {
        type: 'ip_blocked',
        severity: 'warning',
        message: `IP bloquée: ${ip} - ${reason}`
      });
      
      await saveEvent({
        container: 'system',
        eventType: 'ip_blocked',
        details: { ip, reason }
      });
      
      console.log(`IP bloquée: ${ip} - ${reason}`);
    } catch (error) {
      console.error('Erreur lors du blocage IP:', error);
    }
  }

  // ==================== STATS SYSTÈME ====================

  async getSystemStats() {
    const [disk, memory] = await Promise.all([
      this.checkDiskSpace(),
      this.checkMemoryUsage()
    ]);
    
    return {
      disk,
      memory,
      blockedIPs: Array.from(this.blockedIPs),
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = SecurityMonitor;
