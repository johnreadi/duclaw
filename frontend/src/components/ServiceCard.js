import React from 'react';
import { 
  CheckCircle, 
  AlertCircle, 
  XCircle, 
  Activity,
  Cpu,
  MemoryStick,
  RotateCcw
} from 'lucide-react';
import './ServiceCard.css';

function ServiceCard({ service, onClick }) {
  const isRunning = service.checks?.containerRunning;
  const hasErrors = service.errors?.length > 0;
  const restartCount = service.checks?.restartCount || 0;
  
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
          <h3 className="service-name">{service.container}</h3>
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
      </div>
    </div>
  );
}

export default ServiceCard;
