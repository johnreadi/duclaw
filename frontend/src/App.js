import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="app-header">
        <h1>DUCLAW</h1>
        <p>Monitoring et Diagnostic pour Dokploy</p>
      </header>
      <main>
        <Dashboard />
      </main>
    </div>
  );
}

export default App;
