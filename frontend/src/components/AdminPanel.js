import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Users, Plus, Trash2, RefreshCw, Shield, Clock } from 'lucide-react';
import './AdminPanel.css';

function AdminPanel() {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', email: '', password: '', role: 'operator' });
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'audit') fetchAudit();
  }, [activeTab]);

  const token = () => localStorage.getItem('token');

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/users', { headers: { Authorization: `Bearer ${token()}` } });
      setUsers(res.data);
    } catch (e) { showMsg('Erreur chargement utilisateurs', 'error'); }
    setLoading(false);
  };

  const fetchAudit = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/audit?limit=100', { headers: { Authorization: `Bearer ${token()}` } });
      setAuditLog(res.data);
    } catch (e) { showMsg('Erreur chargement audit', 'error'); }
    setLoading(false);
  };

  const createUser = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/users', newUser, { headers: { Authorization: `Bearer ${token()}` } });
      showMsg('Utilisateur créé avec succès', 'success');
      setNewUser({ username: '', email: '', password: '', role: 'operator' });
      setShowAddUser(false);
      fetchUsers();
    } catch (e) {
      showMsg(e.response?.data?.error || 'Erreur création', 'error');
    }
  };

  const deleteUser = async (id, username) => {
    if (!window.confirm(`Supprimer l'utilisateur "${username}" ?`)) return;
    try {
      await axios.delete(`/api/users/${id}`, { headers: { Authorization: `Bearer ${token()}` } });
      showMsg('Utilisateur supprimé', 'success');
      fetchUsers();
    } catch (e) {
      showMsg(e.response?.data?.error || 'Erreur suppression', 'error');
    }
  };

  const showMsg = (text, type) => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const getRoleClass = (role) => {
    if (role === 'admin') return 'badge-admin';
    if (role === 'operator') return 'badge-operator';
    return 'badge-viewer';
  };

  const getEventIcon = (type) => {
    if (type === 'restart') return '🔄';
    if (type === 'stop') return '⏹';
    if (type === 'start') return '▶️';
    if (type === 'delete') return '🗑';
    return '⚡';
  };

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h2><Shield size={20} /> Administration</h2>
      </div>

      {message && (
        <div className={`admin-message ${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="admin-tabs">
        <button className={`tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
          <Users size={14} /> Utilisateurs
        </button>
        <button className={`tab ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>
          <Clock size={14} /> Audit Log
        </button>
      </div>

      {/* Onglet Utilisateurs */}
      {activeTab === 'users' && (
        <div className="admin-content">
          <div className="section-toolbar">
            <h3>Gestion des utilisateurs</h3>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn-icon" onClick={fetchUsers}><RefreshCw size={14} /></button>
              <button className="btn-add" onClick={() => setShowAddUser(!showAddUser)}>
                <Plus size={14} /> Ajouter
              </button>
            </div>
          </div>

          {showAddUser && (
            <form className="add-user-form" onSubmit={createUser}>
              <h4>Nouvel utilisateur</h4>
              <div className="form-row">
                <input
                  placeholder="Nom d'utilisateur"
                  value={newUser.username}
                  onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                  required
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={newUser.email}
                  onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                />
              </div>
              <div className="form-row">
                <input
                  type="password"
                  placeholder="Mot de passe"
                  value={newUser.password}
                  onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                  required
                />
                <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
                  <option value="admin">Admin</option>
                  <option value="operator">Opérateur</option>
                  <option value="viewer">Lecture seule</option>
                </select>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn-primary-sm">Créer</button>
                <button type="button" className="btn-secondary-sm" onClick={() => setShowAddUser(false)}>Annuler</button>
              </div>
            </form>
          )}

          <div className="users-list">
            {loading ? (
              <div className="loading-inline"><RefreshCw className="spin" size={16} /> Chargement...</div>
            ) : (
              users.map(u => (
                <div key={u.id} className="user-item">
                  <div className="user-avatar">{u.username.charAt(0).toUpperCase()}</div>
                  <div className="user-details">
                    <span className="user-name">{u.username}</span>
                    <span className="user-email">{u.email || 'Pas d\'email'}</span>
                  </div>
                  <span className={`role-badge ${getRoleClass(u.role)}`}>{u.role}</span>
                  <span className="user-date">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString('fr-FR') : ''}
                  </span>
                  <button
                    className="btn-delete-user"
                    onClick={() => deleteUser(u.id, u.username)}
                    title="Supprimer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="roles-info">
            <h4>Permissions par rôle</h4>
            <div className="roles-grid">
              <div className="role-card">
                <span className="role-badge badge-admin">Admin</span>
                <ul>
                  <li>✅ Toutes les actions</li>
                  <li>✅ Gestion utilisateurs</li>
                  <li>✅ Audit log</li>
                  <li>✅ Supprimer containers</li>
                </ul>
              </div>
              <div className="role-card">
                <span className="role-badge badge-operator">Opérateur</span>
                <ul>
                  <li>✅ Voir le dashboard</li>
                  <li>✅ Start / Stop / Restart</li>
                  <li>✅ Voir les logs</li>
                  <li>❌ Supprimer containers</li>
                </ul>
              </div>
              <div className="role-card">
                <span className="role-badge badge-viewer">Viewer</span>
                <ul>
                  <li>✅ Voir le dashboard</li>
                  <li>✅ Voir les logs</li>
                  <li>❌ Modifier les containers</li>
                  <li>❌ Actions de remédiation</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Onglet Audit */}
      {activeTab === 'audit' && (
        <div className="admin-content">
          <div className="section-toolbar">
            <h3>Historique des actions</h3>
            <button className="btn-icon" onClick={fetchAudit}><RefreshCw size={14} /></button>
          </div>

          <div className="audit-list">
            {loading ? (
              <div className="loading-inline"><RefreshCw className="spin" size={16} /> Chargement...</div>
            ) : auditLog.length === 0 ? (
              <p className="no-data">Aucune action enregistrée</p>
            ) : (
              auditLog.map((event, i) => (
                <div key={i} className="audit-item">
                  <span className="audit-icon">{getEventIcon(event.event_type)}</span>
                  <div className="audit-details">
                    <span className="audit-action">{event.event_type.toUpperCase()}</span>
                    <span className="audit-container">{event.container_name}</span>
                    {event.details?.user && (
                      <span className="audit-user">par {event.details.user}</span>
                    )}
                  </div>
                  <span className="audit-time">
                    {new Date(event.created_at).toLocaleString('fr-FR')}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminPanel;
