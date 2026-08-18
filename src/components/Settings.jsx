import React, { useContext, useState } from 'react';
import { AppContext }      from '../App.jsx';
import { loadModel, MODEL_ID } from '../ai/engine.js';
import { getAllDocuments, clearAllDocuments, saveDocument }   from '../storage/db.js';
import { t } from '../i18n/index.js';

export default function Settings() {
  const { state, dispatch } = useContext(AppContext);
  const [confirmText, setConfirmText] = useState('');
  const [exportPassword, setExportPassword] = useState('');
  const [restoreFile, setRestoreFile]       = useState(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreStatus, setRestoreStatus]   = useState('');

  async function handleLoadModel() {
    dispatch({ type:'SET_MODEL_STATUS', status:'loading', progress:0, message:'Starting…' });
    try {
      await loadModel((pct, msg) =>
        dispatch({ type:'SET_MODEL_STATUS', status:'loading', progress:pct, message:msg })
      );
      dispatch({ type:'SET_MODEL_STATUS', status:'ready', progress:100, message:'' });
    } catch (err) {
      dispatch({ type:'SET_MODEL_STATUS', status:'error', message: err.message });
    }
  }

  async function deriveKey(password, salt, keyUsage) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      [keyUsage]
    );
  }

  async function handleExportBackup() {
    if (exportPassword.length < 10) { alert('Password must be at least 10 chars.'); return; }
    try {
      const docs = await getAllDocuments();
      const serializedDocs = await Promise.all(docs.map(async doc => {
        let base64Data = null;
        if (doc.file_data instanceof Blob) {
          base64Data = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(doc.file_data);
          });
        }
        return { ...doc, file_data_base64: base64Data, file_data: undefined };
      }));

      const payload = JSON.stringify({ version: '2.0', app: 'Paperwork Assistant', documents: serializedDocs });
      const salt = window.crypto.getRandomValues(new Uint8Array(16));
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const key = await deriveKey(exportPassword, salt, "encrypt");
      const encryptedContent = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(payload));

      const encryptedBytes = new Uint8Array(salt.byteLength + iv.byteLength + encryptedContent.byteLength);
      encryptedBytes.set(salt, 0);
      encryptedBytes.set(iv, salt.byteLength);
      encryptedBytes.set(new Uint8Array(encryptedContent), salt.byteLength + iv.byteLength);

      const blob = new Blob([encryptedBytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `paperwork_backup_${new Date().toISOString().slice(0,10)}.pa`;
      a.click();
      URL.revokeObjectURL(url);
      setExportPassword('');
      alert('Encrypted backup downloaded successfully!');
    } catch (err) { alert('Export failed: ' + err.message); }
  }

  async function handleRestoreBackup(e) {
    e.preventDefault();
    if (!restoreFile || !restorePassword) return;
    try {
      setRestoreStatus('Decrypting...');
      const bytes = new Uint8Array(await restoreFile.arrayBuffer());
      const salt = bytes.slice(0, 16);
      const iv = bytes.slice(16, 28);
      const ciphertext = bytes.slice(28);
      const key = await deriveKey(restorePassword, salt, "decrypt");
      const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
      const backup = JSON.parse(new TextDecoder().decode(decrypted));

      for (const d of backup.documents) {
        let fileBlob = null;
        if (d.file_data_base64) {
          fileBlob = await (await fetch(d.file_data_base64)).blob();
        }
        delete d.file_data_base64;
        delete d.id;
        await saveDocument({ ...d, file_data: fileBlob });
      }

      dispatch({ type: 'SET_DOCUMENTS', documents: await getAllDocuments() });
      setRestoreStatus('✅ Restored successfully!');
      setRestoreFile(null);
      setRestorePassword('');
    } catch (err) { setRestoreStatus('❌ Decryption failed. Incorrect password.'); }
  }

  async function handleResetWorkspace() {
    if (confirmText !== 'CLEAR LOCAL WORKSPACE') return;
    await clearAllDocuments();
    dispatch({ type: 'SET_DOCUMENTS', documents: [] });
    localStorage.removeItem('pa_lang');
    localStorage.removeItem('ai_model_cached');
    alert('Workspace cleared.');
    setConfirmText('');
  }

  return (
    <div className="page-container" style={{ maxWidth: '850px', margin: '0 auto' }}>
      <h1 className="page-title">{t('settings.title')}</h1>

      {/* Stable Multilingual Selector */}
      <section className="settings-card">
        <h2>🌐 Interface & AI Language</h2>
        <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>Choose your preferred language for summaries, insights, and AI analysis.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
          <button className={`btn ${state.language === 'en' ? 'btn-primary' : 'btn-outline'}`} onClick={() => dispatch({ type:'SET_LANGUAGE', payload:'en' })}>🇬🇧 English</button>
          <button className={`btn ${state.language === 'de' ? 'btn-primary' : 'btn-outline'}`} onClick={() => dispatch({ type:'SET_LANGUAGE', payload:'de' })}>🇩🇪 Deutsch</button>
          <button className={`btn ${state.language === 'es' ? 'btn-primary' : 'btn-outline'}`} onClick={() => dispatch({ type:'SET_LANGUAGE', payload:'es' })}>🇪🇸 Español</button>
          <button className={`btn ${state.language === 'fr' ? 'btn-primary' : 'btn-outline'}`} onClick={() => dispatch({ type:'SET_LANGUAGE', payload:'fr' })}>🇫🇷 Français</button>
          <button className={`btn ${state.language === 'ro' ? 'btn-primary' : 'btn-outline'}`} onClick={() => dispatch({ type:'SET_LANGUAGE', payload:'ro' })}>🇷🇴 Română</button>
        </div>
      </section>

      {/* AI Model */}
      <section className="settings-card">
        <h2>{t('settings.ai_model')}</h2>
        <p className="muted">Llama 3.2 3B Instruct (q4f16)</p>
        <p className="muted" style={{ fontSize:'0.75rem', wordBreak:'break-all' }}>Model ID: {MODEL_ID}</p>
        <p className="muted">{t('settings.model_status')}: <strong>{state.modelStatus}</strong>{state.modelStatus === 'loading' && ` — ${state.modelProgress}%`}{state.modelStatus === 'ready' && ' ✅'}</p>
        {state.modelStatus !== 'ready' && (
          <button className="btn btn-primary" onClick={handleLoadModel} disabled={state.modelStatus === 'loading'}>
            {state.modelStatus === 'loading' ? `Loading… ${state.modelProgress}%` : t('model.load_button')}
          </button>
        )}
      </section>

      {/* Backup */}
      <section className="settings-card" style={{ borderLeft: '4px solid var(--accent)' }}>
        <h2>🔒 Encrypted Backup & Restore</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
          <div style={{ padding: '1rem', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: '0.95rem', marginBottom: '0.4rem' }}>Create Encrypted Backup</h3>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="password" placeholder="Password (min 10 chars)" value={exportPassword} onChange={e => setExportPassword(e.target.value)} style={{ padding: '0.45rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.85rem', width: '220px' }} />
              <button className="btn btn-primary btn-sm" disabled={exportPassword.length < 10} onClick={handleExportBackup}>🔐 Download Backup</button>
            </div>
          </div>
          <div style={{ padding: '1rem', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: '0.95rem', marginBottom: '0.4rem' }}>Restore Backup</h3>
            <form onSubmit={handleRestoreBackup} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '350px' }}>
              <input type="file" accept=".pa,.json" onChange={e => setRestoreFile(e.target.files[0])} style={{ fontSize: '0.85rem' }} />
              <input type="password" placeholder="Backup password" value={restorePassword} onChange={e => setRestorePassword(e.target.value)} style={{ padding: '0.45rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.85rem' }} />
              <button type="submit" className="btn btn-outline btn-sm" disabled={!restoreFile || !restorePassword}>🔓 Restore</button>
            </form>
            {restoreStatus && <p style={{ fontSize: '0.85rem', marginTop: '0.5rem', fontWeight: 600 }}>{restoreStatus}</p>}
          </div>
        </div>
      </section>

      {/* Reset */}
      <section className="settings-card settings-card--danger">
        <h2>⚠️ Reset Local Workspace</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Type confirmation: <span style={{ fontFamily: 'monospace', color: 'var(--c-overdue)' }}>CLEAR LOCAL WORKSPACE</span></label>
          <input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="CLEAR LOCAL WORKSPACE" style={{ padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.85rem', maxWidth: '320px' }} />
          <button className="btn btn-danger" disabled={confirmText !== 'CLEAR LOCAL WORKSPACE'} onClick={handleResetWorkspace}>🗑️ Delete Local Workspace</button>
        </div>
      </section>
    </div>
  );
}
