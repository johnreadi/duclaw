import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { AlertTriangle, CheckCircle, Bell, X, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import './Alerts.css';

const ALERTS_PER_PAGE = 5;

function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

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
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch (error) {
      console.error('Erreur:', error);
    }
  };

  const deleteAlert = async (id) => {
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`/api/alerts/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch (error) {
      console.error('Erreur suppression alerte:', error);
    }
  };

  const clearAllAlerts = async () => {
    try {
      const token = localStorage.getItem('token');
      await axios.delete('/api/alerts', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAlerts([]);
      setPage(1);
      setConfirmClearAll(false);
    } catch (error) {
      console.error('Erreur suppression alertes:', error);
    }
  };

  const totalPages = Math.ceil(alerts.length / ALERTS_PER_PAGE);
  const paginatedAlerts = alerts.slice((page - 1) * ALERTS_PER_PAGE, page * ALERTS_PER_PAGE);

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
        <div className="alerts-header-actions">
          <span className="alert-count">{alerts.length} alerte(s)</span>
          {alerts.length > 0 && (
            confirmClearAll ? (
              <div className="confirm-clear">
                <span>Confirmer ?</span>
                <button className="btn-confirm-yes" onClick={clearAllAlerts}>Oui</button>
                <button className="btn-confirm-no" onClick={() => setConfirmClearAll(false)}>Non</button>
              </div>
            ) : (
              <button className="btn-clear-all" onClick={() => setConfirmClearAll(true)} title="Effacer toutes les alertes">
                <Trash2 size={14} /> Tout effacer
              </button>
            )
          )}
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="no-alerts">
          <CheckCircle size={48} />
          <p>Aucune alerte active</p>
        </div>
      ) : (
        <>
          <div className="alerts-list">
            {paginatedAlerts.map((alert) => (
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
                <button
                  className="delete-alert-btn"
                  onClick={() => deleteAlert(alert.id)}
                  title="Supprimer cette alerte"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="alerts-pagination">
              <button
                className="page-btn"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="page-info">{page} / {totalPages}</span>
              <button
                className="page-btn"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default Alerts;
