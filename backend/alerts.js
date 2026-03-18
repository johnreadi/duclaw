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

    // Telegram
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      await this.sendTelegram(containerName, alert);
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

  async sendTelegram(containerName, alert) {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
    const emoji = alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️';
    const text = `${emoji} *DUCLAW Alert*\n\n*Container:* \`${containerName}\`\n*Type:* ${alert.type}\n*Severité:* ${alert.severity.toUpperCase()}\n*Message:* ${alert.message}\n*Date:* ${new Date().toLocaleString('fr-FR')}`;
    try {
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text,
          parse_mode: 'Markdown'
        })
      });
      console.log(`Notification Telegram envoyée pour ${containerName}`);
    } catch (error) {
      console.error('Erreur Telegram:', error.message);
    }
  }

  async sendDailyReport(services) {
    if (!this.transporter || !process.env.ALERT_EMAIL) return;
    const total = services.length;
    const running = services.filter(s => s.checks?.containerRunning).length;
    const errors = services.filter(s => s.errors?.length > 0);
    const stopped = services.filter(s => !s.checks?.containerRunning);

    const errorsHtml = errors.map(s => `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #334155;color:#f8fafc">${s.container}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #334155;color:#ef4444">${s.errors.join(', ')}</td>
      </tr>`).join('');

    const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background:#0f172a;font-family:Arial,sans-serif;color:#f8fafc;padding:2rem">
      <div style="max-width:600px;margin:0 auto">
        <h1 style="color:#3b82f6;border-bottom:2px solid #334155;padding-bottom:1rem">
          📊 DUCLAW - Rapport Quotidien
        </h1>
        <p style="color:#94a3b8">${new Date().toLocaleDateString('fr-FR', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>

        <div style="display:flex;gap:1rem;margin:1.5rem 0">
          <div style="background:#1e293b;border-radius:0.5rem;padding:1rem;flex:1;text-align:center">
            <div style="font-size:2rem;font-weight:bold">${total}</div>
            <div style="color:#94a3b8;font-size:0.875rem">Total</div>
          </div>
          <div style="background:#1e293b;border-radius:0.5rem;padding:1rem;flex:1;text-align:center">
            <div style="font-size:2rem;font-weight:bold;color:#10b981">${running}</div>
            <div style="color:#94a3b8;font-size:0.875rem">En cours</div>
          </div>
          <div style="background:#1e293b;border-radius:0.5rem;padding:1rem;flex:1;text-align:center">
            <div style="font-size:2rem;font-weight:bold;color:#ef4444">${errors.length}</div>
            <div style="color:#94a3b8;font-size:0.875rem">Erreurs</div>
          </div>
          <div style="background:#1e293b;border-radius:0.5rem;padding:1rem;flex:1;text-align:center">
            <div style="font-size:2rem;font-weight:bold;color:#f59e0b">${stopped.length}</div>
            <div style="color:#94a3b8;font-size:0.875rem">Arrêtés</div>
          </div>
        </div>

        ${errors.length > 0 ? `
        <h2 style="color:#ef4444">Containers avec erreurs</h2>
        <table style="width:100%;border-collapse:collapse;background:#1e293b;border-radius:0.5rem">
          <thead>
            <tr>
              <th style="padding:8px 12px;text-align:left;color:#64748b;font-size:0.8rem">Container</th>
              <th style="padding:8px 12px;text-align:left;color:#64748b;font-size:0.8rem">Erreurs</th>
            </tr>
          </thead>
          <tbody>${errorsHtml}</tbody>
        </table>` : '<p style="color:#10b981">✅ Aucune erreur détectée !</p>'}

        <p style="color:#475569;font-size:0.75rem;margin-top:2rem;border-top:1px solid #334155;padding-top:1rem">
          Généré automatiquement par DUCLAW Monitoring
        </p>
      </div>
    </body>
    </html>`;

    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_USER,
        to: process.env.ALERT_EMAIL,
        subject: `📊 DUCLAW Rapport - ${new Date().toLocaleDateString('fr-FR')} - ${errors.length > 0 ? '⚠️ ' + errors.length + ' erreur(s)' : '✅ OK'}`,
        html
      });
      console.log('Rapport quotidien envoyé');
    } catch (error) {
      console.error('Erreur envoi rapport:', error.message);
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
