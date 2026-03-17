import React, { useState } from 'react';
import axios from 'axios';
import { 
  CheckCircle, 
  AlertCircle, 
  XCircle, 
  Activity,
  Cpu,
  MemoryStick,
  RotateCcw,
  Server,
  Database,
  Globe,
  Shield,
  Play,
  Square,
  Trash2,
  ChevronRight,
  Loader
} from 'lucide-react';
import './ServiceCard.css';

function ServiceCard({ service, onClick }) {
  const isRunning = service.checks?.containerRunning;
  const hasErrors = service.errors?.length > 0;
  const restartCount = service.checks?.restartCount || 0;
  const [actionLoading, setActionLoading] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const handleAction = async (e, action) => {
    e.stopPropagation();
    const token = localStorage.getItem('token');
    setActionLoading(action);
    try {
      await axios.post(`/api/services/${encodeURIComponent(service.container)}/${action}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      console.error(`Erreur ${action}:`, error);
    } finally {
      setActionLoading(null);
      setConfirmDelete(false);
      setConfirmStop(false);
    }
  };

  // Déterminer le type de container
  const getContainerType = () => {
    const name = service.container.toLowerCase();
    if (name.includes('dokploy')) return 'infrastructure';
    if (name.includes('traefik')) return 'proxy';
    if (name.includes('redis') || name.includes('db') || name.includes('postgres') || name.includes('mongo')) return 'database';
    if (name.includes('duclaw')) return 'monitoring';
    return 'application';
  };
  
  const getTypeIcon = () => {
    const type = getContainerType();
    switch (type) {
      case 'infrastructure':
        return <Shield size={14} className="type-icon" />;
      case 'proxy':
        return <Globe size={14} className="type-icon" />;
      case 'database':
        return <Database size={14} className="type-icon" />;
      case 'monitoring':
        return <Activity size={14} className="type-icon" />;
      default:
        return <Server size={14} className="type-icon" />;
    }
  };
  
  const getStatusIcon = () => {
    if (!isRunning) return <XCircle className="status-icon error" size={24} />;
    if (hasErrors) return <AlertCircle className="status-icon warning" size={24} />;
    return <CheckCircle className="status-icon success" size={24} />;
  };

  const getStatusClass = () => {
    if (!isRunning) return 'error';
    if (hasErrors) return 'warning';
    return 'success';
  };

  return (
    <div className={`service-card ${getStatusClass()}`} onClick={onClick}>
      <div className="service-header">
        {getStatusIcon()}
        <div className="service-info">
          <div className="service-name-wrapper">
            <h3 className="service-name">{service.container}</h3>
            <span className={`service-type ${getContainerType()}`}>
              {getTypeIcon()}
              {getContainerType()}
            </span>
          </div>
          <span className={`service-status ${getStatusClass()}`}>
            {service.checks?.containerStatus || 'Unknown'}
          </span>
        </div>
      </div>

      <div className="service-metrics">
        <div className="metric">
          <Cpu size={14} />
          <span>{service.checks?.cpuUsage || 'N/A'}</span>
        </div>
        <div className="metric">
          <MemoryStick size={14} />
          <span>{service.checks?.memoryUsage || 'N/A'}</span>
        </div>
        {restartCount > 0 && (
          <div className="metric warning">
            <RotateCcw size={14} />
            <span>{restartCount} restarts</span>
          </div>
        )}
      </div>

      {service.errors?.length > 0 && (
        <div className="service-errors">
          <AlertCircle size={14} />
          <span>{service.errors.length} erreur(s) détectée(s)</span>
        </div>
      )}

      <div className="service-footer">
        <span className="timestamp">
          Mis à jour: {new Date(service.timestamp).toLocaleTimeString('fr-FR')}
        </span>
        <div className="card-actions" onClick={e => e.stopPropagation()}>
          {/* Détails */}
          <button className="action-btn details" onClick={onClick} title="Voir les détails">
            <ChevronRight size={14} />
          </button>

          {/* Restart */}
          <button
            className="action-btn restart"
            onClick={(e) => handleAction(e, 'restart')}
            disabled={actionLoading !== null}
            title="Redémarrer"
          >
            {actionLoading === 'restart' ? <Loader size={14} className="spin" /> : <RotateCcw size={14} />}
          </button>

          {/* Start / Stop avec confirmation */}
          {isRunning ? (
            confirmStop ? (
              <span className="confirm-inline" onClick={e => e.stopPropagation()}>
                <button className="action-btn confirm-yes" onClick={(e) => handleAction(e, 'stop')} title="Confirmer arrêt">
                  {actionLoading === 'stop' ? <Loader size={12} className="spin" /> : 'Oui'}
                </button>
                <button className="action-btn confirm-no" onClick={(e) => { e.stopPropagation(); setConfirmStop(false); }}>Non</button>
              </span>
            ) : (
              <button
                className="action-btn stop"
                onClick={(e) => { e.stopPropagation(); setConfirmStop(true); }}
                disabled={actionLoading !== null}
                title="Arrêter le container"
              >
                <Square size={14} />
              </button>
            )
          ) : (
            <button
              className="action-btn start"
              onClick={(e) => handleAction(e, 'start')}
              disabled={actionLoading !== null}
              title="Démarrer le container"
            >
              {actionLoading === 'start' ? <Loader size={14} className="spin" /> : <Play size={14} />}
            </button>
          )}

          {/* Delete avec double confirmation */}
          {confirmDelete ? (
            <span className="confirm-inline" onClick={e => e.stopPropagation()}>
              <button className="action-btn confirm-yes" onClick={(e) => handleAction(e, 'delete')} title="Confirmer suppression">
                {actionLoading === 'delete' ? <Loader size={12} className="spin" /> : 'Oui'}
              </button>
              <button className="action-btn confirm-no" onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}>Non</button>
            </span>
          ) : (
            <button
              className="action-btn delete"
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              disabled={actionLoading !== null}
              title="Supprimer le container"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ServiceCard;
