import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { 
  Activity, 
  AlertCircle, 
  CheckCircle, 
  RefreshCw, 
  Server,
  Network,
  Search,
  Filter,
  SortAsc,
  X
} from 'lucide-react';
import ServiceCard from './ServiceCard';
import ServiceDetail from './ServiceDetail';
import Alerts from './Alerts';
import SystemStats from './SystemStats';
import './Dashboard.css';

function Dashboard() {
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetchServices();
    
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
    
    ws.onopen = () => setWsConnected(true);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'statusUpdate' || data.type === 'initial') {
        setServices(data.data);
        setLoading(false);
      }
    };
    ws.onclose = () => setWsConnected(false);
    return () => ws.close();
  }, []);

  const fetchServices = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/services', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setServices(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Erreur lors du chargement des services:', error);
      setLoading(false);
    }
  };

  const getContainerType = (name) => {
    const n = name.toLowerCase();
    if (n.includes('traefik')) return 'proxy';
    if (n.includes('dokploy')) return 'infrastructure';
    if (/redis|db|postgres|mongo|mysql|mariadb/.test(n)) return 'database';
    if (n.includes('duclaw')) return 'monitoring';
    return 'application';
  };

  const filteredServices = useMemo(() => {
    let result = [...services];

    // Recherche
    if (search.trim()) {
      result = result.filter(s => 
        s.container.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Filtre par type
    if (filterType !== 'all') {
      result = result.filter(s => getContainerType(s.container) === filterType);
    }

    // Filtre par statut
    if (filterStatus === 'running') result = result.filter(s => s.checks?.containerRunning);
    else if (filterStatus === 'stopped') result = result.filter(s => !s.checks?.containerRunning);
    else if (filterStatus === 'error') result = result.filter(s => s.errors?.length > 0);

    // Tri
    result.sort((a, b) => {
      switch (sortBy) {
        case 'cpu': return parseFloat(b.checks?.cpuUsage || 0) - parseFloat(a.checks?.cpuUsage || 0);
        case 'memory': return parseFloat(b.checks?.memoryUsage || 0) - parseFloat(a.checks?.memoryUsage || 0);
        case 'restarts': return (b.checks?.restartCount || 0) - (a.checks?.restartCount || 0);
        case 'errors': return (b.errors?.length || 0) - (a.errors?.length || 0);
        default: return a.container.localeCompare(b.container);
      }
    });

    return result;
  }, [services, search, filterType, filterStatus, sortBy]);

  const getStats = () => {
    const total = services.length;
    const running = services.filter(s => s.checks?.containerRunning).length;
    const withErrors = services.filter(s => s.errors?.length > 0).length;
    const restartLoops = services.filter(s => s.checks?.restartCount > 5).length;
    return { total, running, withErrors, restartLoops };
  };

  const stats = getStats();
  const hasActiveFilters = search || filterType !== 'all' || filterStatus !== 'all' || sortBy !== 'name';

  const resetFilters = () => {
    setSearch('');
    setFilterType('all');
    setFilterStatus('all');
    setSortBy('name');
  };

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
        <div className="main-panel">
          <div className="services-grid">
            <div className="services-toolbar">
              <div className="toolbar-left">
                <h2>Services Monitorés
                  <span className="filtered-count">
                    {filteredServices.length}/{stats.total}
                  </span>
                </h2>
              </div>
              <div className="toolbar-right">
                {/* Barre de recherche */}
                <div className="search-box">
                  <Search size={14} />
                  <input
                    type="text"
                    placeholder="Rechercher un container..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                  {search && <button onClick={() => setSearch('')}><X size={12} /></button>}
                </div>
                {/* Bouton filtres */}
                <button 
                  className={`btn-filter ${showFilters ? 'active' : ''} ${hasActiveFilters ? 'has-filters' : ''}`}
                  onClick={() => setShowFilters(!showFilters)}
                >
                  <Filter size={14} />
                  Filtres {hasActiveFilters && <span className="filter-dot" />}
                </button>
                {hasActiveFilters && (
                  <button className="btn-reset" onClick={resetFilters} title="Réinitialiser">
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Panneau filtres */}
            {showFilters && (
              <div className="filters-panel">
                <div className="filter-group">
                  <label>Type</label>
                  <select value={filterType} onChange={e => setFilterType(e.target.value)}>
                    <option value="all">Tous</option>
                    <option value="application">Application</option>
                    <option value="database">Database</option>
                    <option value="infrastructure">Infrastructure</option>
                    <option value="proxy">Proxy</option>
                    <option value="monitoring">Monitoring</option>
                  </select>
                </div>
                <div className="filter-group">
                  <label>Statut</label>
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                    <option value="all">Tous</option>
                    <option value="running">En cours</option>
                    <option value="stopped">Arrêté</option>
                    <option value="error">En erreur</option>
                  </select>
                </div>
                <div className="filter-group">
                  <label><SortAsc size={12} /> Trier par</label>
                  <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                    <option value="name">Nom</option>
                    <option value="cpu">CPU (desc)</option>
                    <option value="memory">Mémoire (desc)</option>
                    <option value="restarts">Restarts (desc)</option>
                    <option value="errors">Erreurs (desc)</option>
                  </select>
                </div>
              </div>
            )}

            <div className="grid">
              {filteredServices.length === 0 ? (
                <div className="no-results">
                  <Search size={32} />
                  <p>Aucun container ne correspond aux filtres</p>
                  <button onClick={resetFilters}>Réinitialiser les filtres</button>
                </div>
              ) : (
                filteredServices.map((service) => (
                  <ServiceCard 
                    key={service.container} 
                    service={service}
                    onClick={() => setSelectedService(service)}
                  />
                ))
              )}
            </div>
          </div>

          {selectedService && (
            <ServiceDetail 
              service={selectedService}
              onClose={() => setSelectedService(null)}
            />
          )}
        </div>
        
        <div className="sidebar">
          <SystemStats />
          <Alerts />
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
