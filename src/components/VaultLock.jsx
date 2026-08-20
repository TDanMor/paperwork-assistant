import React, { useState, useContext } from 'react';
import { AppContext } from '../App.jsx';
import { setSessionKey, getAllDocuments, getVaultSalt, verifyVaultPIN } from '../storage/db.js';
import { deriveKeyFromPin } from '../utils/crypto.js';
import { t } from '../i18n/index.js';
import LangSwitcher from './LangSwitcher.jsx';

export default function VaultLock() {
  const { dispatch } = useContext(AppContext);
  const [pin, setPin] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(pin)) {
      alert(t('vault.pin_error'));
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
        alert(t('vault.incorrect_pin'));
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
      alert(`${t('vault.system_error')}${err.message}`);
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleClearData = async () => {
    if (window.confirm(t('vault.reset_confirm'))) {
      const { openDB } = await import('idb');
      await indexedDB.deleteDatabase('paperwork-assistant');
      window.location.reload();
    }
  };

  return (
    <div className="status-card" style={{ maxWidth: '500px', margin: '4rem auto' }}>
      <div className="result-card__icon">🔐</div>
      <h2>{t('vault.title')}</h2>

      <div style={{ margin: '1.5rem 0', padding: '1rem', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
        <p className="muted" style={{ fontSize: '0.8rem', marginBottom: '0.75rem', textAlign: 'center' }}>{t('settings.language')}</p>
        <LangSwitcher />
      </div>

      <p className="muted" style={{ fontSize: '0.85rem' }}>{t('vault.description')}</p>

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
          {isUnlocking ? t('vault.decrypting') : t('vault.unlock')}
        </button>
      </form>

      <button
        onClick={handleClearData}
        className="btn btn-sm"
        style={{ marginTop: '2rem', color: 'var(--c-overdue)', fontSize: '0.7rem', opacity: 0.6 }}
      >
        {t('vault.reset_label')}
      </button>
    </div>
  );
}
