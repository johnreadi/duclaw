import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Activity, 
  AlertCircle, 
  CheckCircle, 
  RefreshCw, 
  Server,
  Cpu,
  MemoryStick,
  Network,
  Terminal
} from 'lucide-react';
import ServiceCard from './ServiceCard';
import ServiceDetail from './ServiceDetail';
import './Dashboard.css';

function Dashboard() {
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    fetchServices();
    
    // Connexion WebSocket pour mises à jour en temps réel
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
    
    ws.onopen = () => {
      setWsConnected(true);
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'statusUpdate' || data.type === 'initial') {
        setServices(data.data);
        setLoading(false);
      }
    };
    
    ws.onclose = () => {
      setWsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, []);

  const fetchServices = async () => {
    try {
      const response = await axios.get('/api/services');
      setServices(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Erreur lors du chargement des services:', error);
      setLoading(false);
    }
  };

  const getStats = () => {
    const total = services.length;
    const running = services.filter(s => s.checks?.containerRunning).length;
    const withErrors = services.filter(s => s.errors?.length > 0).length;
    const restartLoops = services.filter(s => s.checks?.restartCount > 5).length;
    
    return { total, running, withErrors, restartLoops };
  };

  const stats = getStats();

  if (loading) {
    return (
      <div className="loading">
        <RefreshCw className="spin" size={32} />
        <p>Chargement des services...</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="stats-bar">
        <div className="stat-card">
          <Server size={20} />
          <div>
            <span className="stat-value">{stats.total}</span>
            <span className="stat-label">Services</span>
          </div>
        </div>
        <div className="stat-card success">
          <CheckCircle size={20} />
          <div>
            <span className="stat-value">{stats.running}</span>
            <span className="stat-label">En cours</span>
          </div>
        </div>
        <div className="stat-card error">
          <AlertCircle size={20} />
          <div>
            <span className="stat-value">{stats.withErrors}</span>
            <span className="stat-label">Erreurs</span>
          </div>
        </div>
        <div className="stat-card warning">
          <Activity size={20} />
          <div>
            <span className="stat-value">{stats.restartLoops}</span>
            <span className="stat-label">Restart loops</span>
          </div>
        </div>
        <div className={`stat-card ${wsConnected ? 'success' : 'error'}`}>
          <Network size={20} />
          <div>
            <span className="stat-value">{wsConnected ? 'ON' : 'OFF'}</span>
            <span className="stat-label">WebSocket</span>
          </div>
        </div>
      </div>

      <div className="dashboard-content">
        <div className="services-grid">
          <h2>Services Monitorés</h2>
          <div className="grid">
            {services.map((service) => (
              <ServiceCard 
                key={service.container} 
                service={service}
                onClick={() => setSelectedService(service)}
              />
            ))}
          </div>
        </div>

        {selectedService && (
          <ServiceDetail 
            service={selectedService}
            onClose={() => setSelectedService(null)}
          />
        )}
      </div>
    </div>
  );
}

export default Dashboard;
