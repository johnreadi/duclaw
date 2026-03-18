import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import Login from './components/Login';
import AdminPanel from './components/AdminPanel';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState('dashboard');

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) setUser(JSON.parse(savedUser));
    setLoading(false);
  }, []);

  const handleLogin = (userData) => setUser(userData);
  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setActivePage('dashboard');
  };

  if (loading) return <div className="loading">Chargement...</div>;
  if (!user) return <Login onLogin={handleLogin} />;

  return (
    <div className="App">
      <header className="app-header">
        <div className="header-content">
          <div className="header-brand">
            <h1>DUCLAW</h1>
            <p>Monitoring et Diagnostic pour Dokploy</p>
          </div>
          <nav className="header-nav">
            <button 
              className={`nav-btn ${activePage === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActivePage('dashboard')}
            >
              Dashboard
            </button>
            {user.role === 'admin' && (
              <button 
                className={`nav-btn ${activePage === 'admin' ? 'active' : ''}`}
                onClick={() => setActivePage('admin')}
              >
                Administration
              </button>
            )}
          </nav>
          <div className="user-info">
            <span className="user-badge">{user.role}</span>
            <span>{user.username}</span>
            <button onClick={handleLogout} className="logout-btn">
              Déconnexion
            </button>
          </div>
        </div>
      </header>
      <main>
        {activePage === 'dashboard' && <Dashboard user={user} />}
        {activePage === 'admin' && user.role === 'admin' && <AdminPanel />}
      </main>
    </div>
  );
}

export default App;
