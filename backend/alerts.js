const nodemailer = require('nodemailer');
const fetch = require('node-fetch');
const { saveAlert, getActiveAlerts, resolveAlert } = require('./database');

class AlertManager {
  constructor() {
    this.transporter = null;
    this.initEmailTransporter();
    this.activeAlerts = new Map();
  }

  initEmailTransporter() {
    if (process.env.SMTP_HOST) {
      this.transporter = nodemailer.createTransporter({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    }
  }

  async checkAndAlert(containerName, diagnosis) {
    const alerts = [];

    // Vérifier si le container est arrêté
    if (!diagnosis.checks?.containerRunning) {
      alerts.push({
        type: 'container_down',
        severity: 'critical',
        message: `Le container ${containerName} est arrêté`
      });
    }

    // Vérifier les restart loops
    if (diagnosis.checks?.restartCount > 5) {
      alerts.push({
        type: 'restart_loop',
        severity: 'critical',
        message: `Le container ${containerName} est en restart loop (${diagnosis.checks.restartCount} restarts)`
      });
    }

    // Vérifier la mémoire
    const memoryUsage = parseFloat(diagnosis.checks?.memoryUsage);
    if (memoryUsage > 90) {
      alerts.push({
        type: 'high_memory',
        severity: 'warning',
        message: `Mémoire critique sur ${containerName}: ${memoryUsage}%`
      });
    } else if (memoryUsage > 80) {
      alerts.push({
        type: 'high_memory',
        severity: 'info',
        message: `Mémoire élevée sur ${containerName}: ${memoryUsage}%`
      });
    }

    // Vérifier le CPU
    const cpuUsage = parseFloat(diagnosis.checks?.cpuUsage);
    if (cpuUsage > 90) {
      alerts.push({
        type: 'high_cpu',
        severity: 'warning',
        message: `CPU critique sur ${containerName}: ${cpuUsage}%`
      });
    }

    // Vérifier les erreurs dans les logs
    if (diagnosis.errors?.length > 0) {
      diagnosis.errors.forEach(error => {
        alerts.push({
          type: 'log_error',
          severity: 'warning',
          message: `Erreur détectée sur ${containerName}: ${error}`
        });
      });
    }

    // Traiter les alertes
    for (const alert of alerts) {
      await this.processAlert(containerName, alert);
    }

    // Résoudre les alertes qui ne sont plus pertinentes
    await this.resolveStaleAlerts(containerName, alerts);
  }

  async processAlert(containerName, alert) {
    const alertKey = `${containerName}:${alert.type}`;
    
    // Vérifier si cette alerte est déjà active
    if (this.activeAlerts.has(alertKey)) {
      return;
    }

    // Sauvegarder dans la base de données
    const alertId = await saveAlert({
      container: containerName,
      alertType: alert.type,
      severity: alert.severity,
      message: alert.message
    });

    this.activeAlerts.set(alertKey, {
      id: alertId,
      ...alert,
      timestamp: new Date()
    });

    // Envoyer les notifications
    await this.sendNotifications(containerName, alert);
  }

  async sendNotifications(containerName, alert) {
    // Email
    if (this.transporter && process.env.ALERT_EMAIL) {
      await this.sendEmail(containerName, alert);
    }

    // Slack
    if (process.env.SLACK_WEBHOOK_URL) {
      await this.sendSlack(containerName, alert);
    }

    // Discord
    if (process.env.DISCORD_WEBHOOK_URL) {
      await this.sendDiscord(containerName, alert);
    }

    // Webhook générique
    if (process.env.ALERT_WEBHOOK_URL) {
      await this.sendWebhook(containerName, alert);
    }
  }

  async sendEmail(containerName, alert) {
    const severityColors = {
      critical: '#ef4444',
      warning: '#f59e0b',
      info: '#3b82f6'
    };

    const mailOptions = {
      from: process.env.SMTP_FROM || 'duclaw@monitoring.local',
      to: process.env.ALERT_EMAIL,
      subject: `[DUCLAW] ${alert.severity.toUpperCase()}: ${alert.type} - ${containerName}`,
      html: `
        <h2 style="color: ${severityColors[alert.severity]}">Alerte ${alert.severity}</h2>
        <p><strong>Container:</strong> ${containerName}</p>
        <p><strong>Type:</strong> ${alert.type}</p>
        <p><strong>Message:</strong> ${alert.message}</p>
        <p><strong>Date:</strong> ${new Date().toLocaleString('fr-FR')}</p>
        <hr>
        <p><em>DUCLAW Monitoring</em></p>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Email envoyé pour l'alerte ${alert.type} sur ${containerName}`);
    } catch (error) {
      console.error('Erreur lors de l\'envoi de l\'email:', error);
    }
  }

  async sendSlack(containerName, alert) {
    const severityEmojis = {
      critical: '🔴',
      warning: '🟡',
      info: '🔵'
    };

    const payload = {
      text: `${severityEmojis[alert.severity]} Alerte DUCLAW`,
      attachments: [{
        color: alert.severity === 'critical' ? 'danger' : alert.severity === 'warning' ? 'warning' : 'good',
        fields: [
          { title: 'Container', value: containerName, short: true },
          { title: 'Type', value: alert.type, short: true },
          { title: 'Message', value: alert.message, short: false },
          { title: 'Date', value: new Date().toLocaleString('fr-FR'), short: false }
        ]
      }]
    };

    try {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      console.log(`Notification Slack envoyée pour ${containerName}`);
    } catch (error) {
      console.error('Erreur lors de l\'envoi à Slack:', error);
    }
  }

  async sendDiscord(containerName, alert) {
    const severityColors = {
      critical: 0xef4444,
      warning: 0xf59e0b,
      info: 0x3b82f6
    };

    const payload = {
      embeds: [{
        title: `🚨 Alerte ${alert.severity.toUpperCase()}`,
        color: severityColors[alert.severity],
        fields: [
          { name: 'Container', value: containerName, inline: true },
          { name: 'Type', value: alert.type, inline: true },
          { name: 'Message', value: alert.message, inline: false },
          { name: 'Date', value: new Date().toLocaleString('fr-FR'), inline: false }
        ],
        footer: { text: 'DUCLAW Monitoring' },
        timestamp: new Date().toISOString()
      }]
    };

    try {
      await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      console.log(`Notification Discord envoyée pour ${containerName}`);
    } catch (error) {
      console.error('Erreur lors de l\'envoi à Discord:', error);
    }
  }

  async sendWebhook(containerName, alert) {
    const payload = {
      source: 'duclaw',
      container: containerName,
      alertType: alert.type,
      severity: alert.severity,
      message: alert.message,
      timestamp: new Date().toISOString()
    };

    try {
      await fetch(process.env.ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      console.log(`Webhook envoyé pour ${containerName}`);
    } catch (error) {
      console.error('Erreur lors de l\'envoi du webhook:', error);
    }
  }

  async resolveStaleAlerts(containerName, currentAlerts) {
    const currentAlertTypes = new Set(currentAlerts.map(a => a.type));
    
    for (const [key, alert] of this.activeAlerts.entries()) {
      if (key.startsWith(`${containerName}:`) && !currentAlertTypes.has(alert.type)) {
        await resolveAlert(alert.id);
        this.activeAlerts.delete(key);
        console.log(`Alerte résolue: ${alert.type} sur ${containerName}`);
      }
    }
  }

  getActiveAlertsList() {
    return Array.from(this.activeAlerts.entries()).map(([key, alert]) => ({
      key,
      ...alert
    }));
  }
}

module.exports = AlertManager;
