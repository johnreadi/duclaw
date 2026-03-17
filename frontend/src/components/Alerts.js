import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { AlertTriangle, CheckCircle, Bell, X } from 'lucide-react';
import './Alerts.css';

function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchAlerts = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/alerts', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAlerts(response.data);
    } catch (error) {
      console.error('Erreur lors du chargement des alertes:', error);
    } finally {
      setLoading(false);
    }
  };

  const acknowledgeAlert = async (id) => {
    try {
      const token = localStorage.getItem('token');
      await axios.post(`/api/alerts/${id}/acknowledge`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchAlerts();
    } catch (error) {
      console.error('Erreur:', error);
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical':
        return <AlertTriangle className="severity-critical" size={20} />;
      case 'warning':
        return <AlertTriangle className="severity-warning" size={20} />;
      default:
        return <Bell className="severity-info" size={20} />;
    }
  };

  const getSeverityClass = (severity) => {
    return `alert-item ${severity}`;
  };

  if (loading) {
    return <div className="alerts-loading">Chargement des alertes...</div>;
  }

  return (
    <div className="alerts-container">
      <div className="alerts-header">
        <h2><Bell size={20} /> Alertes Actives</h2>
        <span className="alert-count">{alerts.length} alerte(s)</span>
      </div>

      {alerts.length === 0 ? (
        <div className="no-alerts">
          <CheckCircle size={48} />
          <p>Aucune alerte active</p>
        </div>
      ) : (
        <div className="alerts-list">
          {alerts.map((alert) => (
            <div key={alert.id} className={getSeverityClass(alert.severity)}>
              <div className="alert-icon">
                {getSeverityIcon(alert.severity)}
              </div>
              <div className="alert-content">
                <div className="alert-header">
                  <span className="alert-type">{alert.alert_type}</span>
                  <span className="alert-container">{alert.container_name}</span>
                </div>
                <p className="alert-message">{alert.message}</p>
                <span className="alert-time">
                  {new Date(alert.created_at).toLocaleString('fr-FR')}
                </span>
              </div>
              {!alert.acknowledged && (
                <button 
                  className="acknowledge-btn"
                  onClick={() => acknowledgeAlert(alert.id)}
                  title="Acquitter l'alerte"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Alerts;
