import React, { useState, useContext } from 'react';
import { AppContext } from '../App.jsx';
import { setSessionKey, getAllDocuments, getVaultSalt } from '../storage/db.js';
import { deriveKeyFromPin } from '../utils/crypto.js';

export default function VaultLock() {
  const { dispatch } = useContext(AppContext);
  const [pin, setPin] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(pin)) {
      alert('PIN must be exactly 6 digits.');
      return;
    }

    setIsUnlocking(true);
    try {
      // 1. Get the persisted master salt
      const salt = await getVaultSalt();

      // 2. Derive the key (Takes ~0.5s due to 600k iterations)
      const key = await deriveKeyFromPin(pin, salt);

      // 3. Verify PIN with Canary
      const isValid = await verifyVaultPIN(key);
      if (!isValid) {
        alert("Incorrect PIN. Please try again.");
        return;
      }

      // 4. Store key in volatile memory
      setSessionKey(key);

      // 5. Unlock UI
      dispatch({ type: 'SET_VAULT_LOCKED', payload: false });

      // 5. Refresh documents
      const docs = await getAllDocuments();
      dispatch({ type: 'SET_DOCUMENTS', documents: docs });
    } catch (err) {
      console.error("Unlock failed:", err);
      alert("System error during unlock. Please try again.");
    } finally {
      setIsUnlocking(false);
    }
  };

  return (
    <div className="status-card" style={{ maxWidth: '400px', margin: '4rem auto' }}>
      <div className="result-card__icon">🔐</div>
      <h2>Personal Vault Locked</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>Enter your 6-digit PIN to decrypt your data. This PIN is never saved and ensures your privacy even if your device is lost.</p>

      <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
        <input
          type="password"
          placeholder="000000"
          value={pin}
          maxLength={6}
          disabled={isUnlocking}
          onChange={e => setPin(e.target.value)}
          style={{
            textAlign: 'center',
            fontSize: '1.8rem',
            letterSpacing: '0.6rem',
            padding: '0.5rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            fontFamily: 'monospace'
          }}
        />
        <button className="btn btn-primary" type="submit" disabled={isUnlocking || pin.length < 6}>
          {isUnlocking ? 'Decrypting Vault...' : 'Unlock Vault'}
        </button>
      </form>
    </div>
  );
}
