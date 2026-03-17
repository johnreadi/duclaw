const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'duclaw-db',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'duclaw',
  user: process.env.DB_USER || 'duclaw',
  password: process.env.DB_PASSWORD || 'duclaw_password',
});

// Initialisation de la base de données
async function initDatabase() {
  const client = await pool.connect();
  try {
    // Table des métriques
    await client.query(`
      CREATE TABLE IF NOT EXISTS metrics (
        id SERIAL PRIMARY KEY,
        container_name VARCHAR(255) NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        cpu_usage DECIMAL(5,2),
        memory_usage DECIMAL(5,2),
        memory_limit BIGINT,
        status VARCHAR(50),
        restart_count INTEGER DEFAULT 0,
        health_status VARCHAR(50)
      )
    `);

    // Table des alertes
    await client.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        container_name VARCHAR(255) NOT NULL,
        alert_type VARCHAR(100) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        message TEXT,
        acknowledged BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP
      )
    `);

    // Table des événements
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        container_name VARCHAR(255) NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        details JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Table des certificats SSL
    await client.query(`
      CREATE TABLE IF NOT EXISTS ssl_certificates (
        id SERIAL PRIMARY KEY,
        domain VARCHAR(255) NOT NULL,
        valid_from TIMESTAMP,
        valid_to TIMESTAMP,
        days_remaining INTEGER,
        issuer VARCHAR(255),
        last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Table des utilisateurs
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      )
    `);

    // Table des configurations d'alertes
    await client.query(`
      CREATE TABLE IF NOT EXISTS alert_configs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        alert_type VARCHAR(100) NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        threshold DECIMAL(5,2),
        webhook_url TEXT,
        email_notifications BOOLEAN DEFAULT TRUE,
        slack_webhook TEXT,
        discord_webhook TEXT
      )
    `);

    // Index pour améliorer les performances
    await client.query(`CREATE INDEX IF NOT EXISTS idx_metrics_container ON metrics(container_name)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alerts_container ON alerts(container_name)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_events_container ON events(container_name)`);

    console.log('Base de données initialisée avec succès');
  } catch (error) {
    console.error('Erreur lors de l\'initialisation de la base de données:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Fonctions utilitaires
async function saveMetric(data) {
  const query = `
    INSERT INTO metrics (container_name, cpu_usage, memory_usage, memory_limit, status, restart_count, health_status)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `;
  await pool.query(query, [
    data.container,
    data.cpuUsage,
    data.memoryUsage,
    data.memoryLimit,
    data.status,
    data.restartCount,
    data.healthStatus
  ]);
}

async function saveAlert(data) {
  const query = `
    INSERT INTO alerts (container_name, alert_type, severity, message)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `;
  const result = await pool.query(query, [
    data.container,
    data.alertType,
    data.severity,
    data.message
  ]);
  return result.rows[0].id;
}

async function saveEvent(data) {
  const query = `
    INSERT INTO events (container_name, event_type, details)
    VALUES ($1, $2, $3)
  `;
  await pool.query(query, [
    data.container,
    data.eventType,
    JSON.stringify(data.details)
  ]);
}

async function getMetricsHistory(containerName, hours = 24) {
  const query = `
    SELECT * FROM metrics 
    WHERE container_name = $1 
    AND timestamp > NOW() - INTERVAL '${hours} hours'
    ORDER BY timestamp DESC
  `;
  const result = await pool.query(query, [containerName]);
  return result.rows;
}

async function getActiveAlerts() {
  const query = `
    SELECT * FROM alerts 
    WHERE resolved_at IS NULL 
    ORDER BY created_at DESC
  `;
  const result = await pool.query(query);
  return result.rows;
}

async function acknowledgeAlert(alertId) {
  const query = `
    UPDATE alerts 
    SET acknowledged = TRUE 
    WHERE id = $1
  `;
  await pool.query(query, [alertId]);
}

async function resolveAlert(alertId) {
  const query = `
    UPDATE alerts 
    SET resolved_at = CURRENT_TIMESTAMP 
    WHERE id = $1
  `;
  await pool.query(query, [alertId]);
}

async function saveSSLCertificate(data) {
  const query = `
    INSERT INTO ssl_certificates (domain, valid_from, valid_to, days_remaining, issuer)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (domain) DO UPDATE SET
      valid_from = EXCLUDED.valid_from,
      valid_to = EXCLUDED.valid_to,
      days_remaining = EXCLUDED.days_remaining,
      issuer = EXCLUDED.issuer,
      last_checked = CURRENT_TIMESTAMP
  `;
  await pool.query(query, [
    data.domain,
    data.validFrom,
    data.validTo,
    data.daysRemaining,
    data.issuer
  ]);
}

async function getSSLCertificates() {
  const query = `SELECT * FROM ssl_certificates ORDER BY days_remaining ASC`;
  const result = await pool.query(query);
  return result.rows;
}

module.exports = {
  pool,
  initDatabase,
  saveMetric,
  saveAlert,
  saveEvent,
  getMetricsHistory,
  getActiveAlerts,
  acknowledgeAlert,
  resolveAlert,
  saveSSLCertificate,
  getSSLCertificates
};
