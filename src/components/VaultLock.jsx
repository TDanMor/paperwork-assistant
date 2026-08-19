import React, { useState, useContext } from 'react';
import { AppContext } from '../App.jsx';
import { setSessionPin, getAllDocuments } from '../storage/db.js';

export default function VaultLock() {
  const { dispatch } = useContext(AppContext);
  const [pin, setPin] = useState('');

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (pin.length < 4) {
      alert('PIN must be at least 4 digits.');
      return;
    }

    // Set PIN in memory (volatile storage only)
    setSessionPin(pin);

    // Unlock UI
    dispatch({ type: 'SET_VAULT_LOCKED', payload: false });

    // Refresh documents now that we can decrypt them
    try {
      const docs = await getAllDocuments();
      dispatch({ type: 'SET_DOCUMENTS', documents: docs });
    } catch (err) {
      console.error("Failed to load documents after unlock:", err);
    }
  };

  return (
    <div className="status-card" style={{ maxWidth: '400px', margin: '4rem auto' }}>
      <div className="result-card__icon">🔒</div>
      <h2>Personal Vault Locked</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>Enter your 4-digit PIN to decrypt your documents. This PIN is never saved and exists only in your current session.</p>

      <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
        <input
          type="password"
          placeholder="Enter PIN"
          value={pin}
          onChange={e => setPin(e.target.value)}
          style={{
            textAlign: 'center',
            fontSize: '1.5rem',
            letterSpacing: '0.5rem',
            padding: '0.5rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)'
          }}
        />
        <button className="btn btn-primary" type="submit">Unlock Vault</button>
      </form>
    </div>
  );
}
