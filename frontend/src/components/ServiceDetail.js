import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  X, 
  Terminal, 
  RefreshCw, 
  AlertTriangle,
  Lightbulb,
  Server,
  Activity,
  Shield,
  Play,
  BarChart2,
  Radio,
  Download
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import './ServiceDetail.css';

function ServiceDetail({ service, onClose }) {
  const [logs, setLogs] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const [liveLogs, setLiveLogs] = useState([]);
  const [liveMode, setLiveMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [remediation, setRemediation] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [activeTab, setActiveTab] = useState('info');
  const liveWsRef = useRef(null);
  const logsEndRef = useRef(null);

  useEffect(() => {
    if (service.remediation) setRemediation(service.remediation);
    fetchMetrics();
    return () => { if (liveWsRef.current) liveWsRef.current.close(); };
  }, [service]);

  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [liveLogs]);

  const fetchMetrics = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/services/${encodeURIComponent(service.container)}/metrics?limit=30`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = (response.data || []).map(m => ({
        time: new Date(m.recorded_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        cpu: parseFloat(m.cpu_usage) || 0,
        memory: parseFloat(m.memory_usage) || 0
      })).reverse();
      setMetrics(data);
    } catch (e) {}
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/services/${encodeURIComponent(service.container)}/logs?tail=100`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setLogs(response.data.logs);
      setShowLogs(true);
    } catch (error) {
      console.error('Erreur logs:', error);
    }
    setLoading(false);
  };

  const startLiveLogs = () => {
    if (liveWsRef.current) liveWsRef.current.close();
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/logs/${encodeURIComponent(service.container)}`);
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'log') {
          setLiveLogs(prev => [...prev.slice(-200), data.line]);
        }
      } catch {}
    };
    ws.onclose = () => setLiveMode(false);
    liveWsRef.current = ws;
    setLiveMode(true);
    setLiveLogs([]);
  };

  const stopLiveLogs = () => {
    if (liveWsRef.current) liveWsRef.current.close();
    setLiveMode(false);
  };

  const downloadLogs = () => {
    const content = showLogs ? logs : liveLogs.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${service.container}-logs.txt`;
    a.click();
  };

  const restartService = async () => {
    if (!window.confirm(`Redémarrer le service ${service.container} ?`)) return;
    try {
      const token = localStorage.getItem('token');
      await axios.post(`/api/services/${encodeURIComponent(service.container)}/restart`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('Service redémarré avec succès');
    } catch (error) {
      alert('Erreur lors du redémarrage: ' + error.message);
    }
  };

  const fetchRemediation = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/services/${encodeURIComponent(service.container)}/remediation`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRemediation(response.data);
    } catch (error) {}
  };

  const executeRemediation = async (action) => {
    try {
      const token = localStorage.getItem('token');
      await axios.post(`/api/services/${encodeURIComponent(service.container)}/remediate`,
        { action },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      alert('Action exécutée avec succès');
      fetchRemediation();
    } catch (error) {
      alert('Erreur: ' + error.message);
    }
  };

  const getLogLineClass = (line) => {
    if (/error|err|critical|fatal/i.test(line)) return 'log-error';
    if (/warn|warning/i.test(line)) return 'log-warn';
    if (/info|start|ready|listen/i.test(line)) return 'log-info';
    return '';
  };

  return (
    <div className="service-detail-overlay" onClick={onClose}>
      <div className="service-detail" onClick={e => e.stopPropagation()}>
        <div className="detail-header">
          <h2>{service.container}</h2>
          <button className="close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        {/* Tabs navigation */}
        <div className="detail-tabs">
          <button className={activeTab === 'info' ? 'tab active' : 'tab'} onClick={() => setActiveTab('info')}>
            <Activity size={14} /> Info
          </button>
          <button className={activeTab === 'metrics' ? 'tab active' : 'tab'} onClick={() => { setActiveTab('metrics'); fetchMetrics(); }}>
            <BarChart2 size={14} /> Graphiques
          </button>
          <button className={activeTab === 'logs' ? 'tab active' : 'tab'} onClick={() => { setActiveTab('logs'); fetchLogs(); }}>
            <Terminal size={14} /> Logs
          </button>
          <button className={activeTab === 'remediation' ? 'tab active' : 'tab'} onClick={() => { setActiveTab('remediation'); fetchRemediation(); }}>
            <Shield size={14} /> Remédiation
          </button>
        </div>

        <div className="detail-content">

          {/* Onglet Info */}
          {activeTab === 'info' && (
            <>
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

              <section className="detail-section">
                <h3><Server size={16} /> Ressources</h3>
                <div className="info-grid">
                  <div className="info-item">
                    <span className="label">CPU:</span>
                    <span className="value">{service.checks?.cpuUsage}%</span>
                  </div>
                  <div className="info-item">
                    <span className="label">Mémoire:</span>
                    <span className="value">{service.checks?.memoryUsage}%</span>
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

              {service.errors?.length > 0 && (
                <section className="detail-section errors">
                  <h3><AlertTriangle size={16} /> Erreurs détectées</h3>
                  <ul className="error-list">
                    {service.errors.map((error, idx) => <li key={idx} className="error-item">{error}</li>)}
                  </ul>
                </section>
              )}

              {service.recommendations?.length > 0 && (
                <section className="detail-section recommendations">
                  <h3><Lightbulb size={16} /> Recommandations</h3>
                  <ul className="recommendation-list">
                    {service.recommendations.map((rec, idx) => <li key={idx} className="recommendation-item">{rec}</li>)}
                  </ul>
                </section>
              )}

              <div className="detail-actions">
                <button className="btn btn-danger" onClick={restartService}>
                  <RefreshCw size={16} /> Redémarrer
                </button>
              </div>
            </>
          )}

          {/* Onglet Graphiques */}
          {activeTab === 'metrics' && (
            <section className="detail-section">
              <div className="metrics-header">
                <h3><BarChart2 size={16} /> Historique CPU / Mémoire</h3>
                <button className="btn-icon" onClick={fetchMetrics} title="Actualiser"><RefreshCw size={14} /></button>
              </div>
              {metrics.length === 0 ? (
                <p className="no-data">Pas encore de données historiques</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={metrics} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} domain={[0, 'auto']} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '0.375rem' }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Line type="monotone" dataKey="cpu" stroke="#3b82f6" dot={false} name="CPU %" strokeWidth={2} />
                    <Line type="monotone" dataKey="memory" stroke="#10b981" dot={false} name="Mém %" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </section>
          )}

          {/* Onglet Logs */}
          {activeTab === 'logs' && (
            <section className="detail-section logs-section">
              <div className="logs-toolbar">
                <h3><Terminal size={16} /> Logs</h3>
                <div className="logs-actions">
                  {liveMode ? (
                    <button className="btn-live active" onClick={stopLiveLogs}>
                      <Radio size={14} className="pulse" /> Live ON
                    </button>
                  ) : (
                    <button className="btn-live" onClick={startLiveLogs}>
                      <Radio size={14} /> Live
                    </button>
                  )}
                  <button className="btn-icon" onClick={fetchLogs} title="Rafraîchir">
                    <RefreshCw size={14} />
                  </button>
                  {(logs || liveLogs.length > 0) && (
                    <button className="btn-icon" onClick={downloadLogs} title="Télécharger">
                      <Download size={14} />
                    </button>
                  )}
                </div>
              </div>
              <div className="logs-content">
                {liveMode ? (
                  liveLogs.length === 0 ? (
                    <p className="log-waiting">En attente de logs...</p>
                  ) : (
                    liveLogs.map((line, i) => (
                      <div key={i} className={`log-line ${getLogLineClass(line)}`}>{line}</div>
                    ))
                  )
                ) : (
                  logs ? (
                    logs.split('\n').map((line, i) => (
                      <div key={i} className={`log-line ${getLogLineClass(line)}`}>{line}</div>
                    ))
                  ) : (
                    <p className="log-waiting">Cliquez sur Rafraîchir pour charger les logs</p>
                  )
                )}
                <div ref={logsEndRef} />
              </div>
            </section>
          )}

          {/* Onglet Rémédiation */}
          {activeTab === 'remediation' && (
            <section className="detail-section">
              <h3><Shield size={16} /> Actions de remédiation</h3>
              {!remediation || !remediation.actions?.length ? (
                <p className="no-data">Aucune action de remédiation disponible</p>
              ) : (
                <div className="remediation-actions">
                  {remediation.actions.map((action, idx) => (
                    <div key={idx} className={`remediation-item ${action.priority}`}>
                      <div className="remediation-info">
                        <span className="remediation-type">{action.type}</span>
                        <span className="remediation-desc">{action.description}</span>
                        {action.automated && <span className="automated-badge">Auto</span>}
                      </div>
                      {!action.automated && (
                        <button className="btn btn-small btn-primary" onClick={() => executeRemediation(action.type)}>
                          <Play size={14} /> Exécuter
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

        </div>
      </div>
    </div>
  );
}

export default ServiceDetail;

