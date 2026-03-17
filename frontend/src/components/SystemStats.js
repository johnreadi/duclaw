import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { HardDrive, MemoryStick, Shield, AlertTriangle, Trash2 } from 'lucide-react';
import './SystemStats.css';

function SystemStats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/system/stats', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStats(response.data);
    } catch (error) {
      console.error('Erreur:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCleanup = async () => {
    if (!window.confirm('Lancer le nettoyage du disque ?')) return;
    
    setCleaning(true);
    try {
      const token = localStorage.getItem('token');
      await axios.post('/api/system/cleanup', {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('Nettoyage lancé');
      fetchStats();
    } catch (error) {
      alert('Erreur: ' + error.message);
    } finally {
      setCleaning(false);
    }
  };

  if (loading) return <div className="stats-loading">Chargement...</div>;
  if (!stats) return null;

  const getUsageColor = (percent) => {
    if (percent > 90) return 'critical';
    if (percent > 80) return 'warning';
    return 'good';
  };

  return (
    <div className="system-stats">
      <h3><Shield size={16} /> État du VPS</h3>
      
      {/* Disque */}
      {stats.disk && (
        <div className="stat-item">
          <div className="stat-header">
            <HardDrive size={16} />
            <span>Disque</span>
            <span className={`stat-value ${getUsageColor(stats.disk.usage)}`}>
              {stats.disk.usage}%
            </span>
          </div>
          <div className="progress-bar">
            <div 
              className={`progress-fill ${getUsageColor(stats.disk.usage)}`}
              style={{ width: `${stats.disk.usage}%` }}
            />
          </div>
          <div className="stat-details">
            {stats.disk.used} / {stats.disk.total}
          </div>
          {stats.disk.usage > 80 && (
            <button 
              className="cleanup-btn"
              onClick={handleCleanup}
              disabled={cleaning}
            >
              <Trash2 size={14} />
              {cleaning ? 'Nettoyage...' : 'Nettoyer'}
            </button>
          )}
        </div>
      )}

      {/* Mémoire */}
      {stats.memory && (
        <div className="stat-item">
          <div className="stat-header">
            <MemoryStick size={16} />
            <span>Mémoire</span>
            <span className={`stat-value ${getUsageColor(stats.memory.usagePercent)}`}>
              {stats.memory.usagePercent}%
            </span>
          </div>
          <div className="progress-bar">
            <div 
              className={`progress-fill ${getUsageColor(stats.memory.usagePercent)}`}
              style={{ width: `${stats.memory.usagePercent}%` }}
            />
          </div>
          <div className="stat-details">
            {stats.memory.used}MB / {stats.memory.total}MB
          </div>
        </div>
      )}

      {/* IPs bloquées */}
      {stats.blockedIPs && stats.blockedIPs.length > 0 && (
        <div className="stat-item security">
          <div className="stat-header">
            <AlertTriangle size={16} />
            <span>Sécurité</span>
          </div>
          <div className="blocked-ips">
            <span>{stats.blockedIPs.length} IP(s) bloquée(s)</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default SystemStats;
