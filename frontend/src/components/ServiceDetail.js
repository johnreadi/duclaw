import React, { useState } from 'react';
import axios from 'axios';
import { 
  X, 
  Terminal, 
  RefreshCw, 
  AlertTriangle,
  Lightbulb,
  Server,
  Activity
} from 'lucide-react';
import './ServiceDetail.css';

function ServiceDetail({ service, onClose }) {
  const [logs, setLogs] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/services/${service.container}/logs?tail=100`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setLogs(response.data.logs);
      setShowLogs(true);
    } catch (error) {
      console.error('Erreur lors du chargement des logs:', error);
    }
    setLoading(false);
  };

  const restartService = async () => {
    if (!window.confirm(`Redémarrer le service ${service.container} ?`)) return;
    
    try {
      const token = localStorage.getItem('token');
      await axios.post(`/api/services/${service.container}/restart`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('Service redémarré avec succès');
    } catch (error) {
      alert('Erreur lors du redémarrage: ' + error.message);
    }
  };

  return (
    <div className="service-detail-overlay" onClick={onClose}>
      <div className="service-detail" onClick={e => e.stopPropagation()}>
        <div className="detail-header">
          <h2>{service.container}</h2>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="detail-content">
          {/* Statut */}
          <section className="detail-section">
            <h3><Activity size={16} /> Statut</h3>
            <div className="info-grid">
              <div className="info-item">
                <span className="label">État:</span>
                <span className={`value ${service.checks?.containerRunning ? 'success' : 'error'}`}>
                  {service.checks?.containerRunning ? 'En cours' : 'Arrêté'}
                </span>
              </div>
              <div className="info-item">
                <span className="label">Status:</span>
                <span className="value">{service.checks?.containerStatus}</span>
              </div>
              <div className="info-item">
                <span className="label">Health:</span>
                <span className="value">{service.checks?.health}</span>
              </div>
              <div className="info-item">
                <span className="label">Restarts:</span>
                <span className={`value ${service.checks?.restartCount > 5 ? 'error' : ''}`}>
                  {service.checks?.restartCount}
                </span>
              </div>
            </div>
          </section>

          {/* Ressources */}
          <section className="detail-section">
            <h3><Server size={16} /> Ressources</h3>
            <div className="info-grid">
              <div className="info-item">
                <span className="label">CPU:</span>
                <span className="value">{service.checks?.cpuUsage}</span>
              </div>
              <div className="info-item">
                <span className="label">Mémoire:</span>
                <span className="value">{service.checks?.memoryUsage}</span>
              </div>
              <div className="info-item">
                <span className="label">IP:</span>
                <span className="value">{service.checks?.ipAddress}</span>
              </div>
              <div className="info-item">
                <span className="label">Réseaux:</span>
                <span className="value">{service.checks?.networks?.join(', ')}</span>
              </div>
            </div>
          </section>

          {/* Erreurs */}
          {service.errors?.length > 0 && (
            <section className="detail-section errors">
              <h3><AlertTriangle size={16} /> Erreurs détectées</h3>
              <ul className="error-list">
                {service.errors.map((error, idx) => (
                  <li key={idx} className="error-item">{error}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Recommandations */}
          {service.recommendations?.length > 0 && (
            <section className="detail-section recommendations">
              <h3><Lightbulb size={16} /> Recommandations</h3>
              <ul className="recommendation-list">
                {service.recommendations.map((rec, idx) => (
                  <li key={idx} className="recommendation-item">{rec}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Logs */}
          {showLogs && (
            <section className="detail-section logs">
              <h3><Terminal size={16} /> Logs récents</h3>
              <pre className="logs-content">{logs}</pre>
            </section>
          )}

          {/* Actions */}
          <div className="detail-actions">
            <button 
              className="btn btn-primary" 
              onClick={fetchLogs}
              disabled={loading}
            >
              {loading ? <RefreshCw className="spin" size={16} /> : <Terminal size={16} />}
              {showLogs ? 'Rafraîchir logs' : 'Voir les logs'}
            </button>
            <button 
              className="btn btn-danger" 
              onClick={restartService}
            >
              <RefreshCw size={16} />
              Redémarrer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ServiceDetail;
