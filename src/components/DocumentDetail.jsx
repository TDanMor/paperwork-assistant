import React, { useContext, useState, useEffect } from 'react';
import { AppContext }      from '../App.jsx';
import { getDocumentById, deleteDocument, updateDocument } from '../storage/db.js';
import { generateGoogleCalendarUrl } from '../utils/calendar.js';
import { t } from '../i18n/index.js';

export default function DocumentDetail({ docId }) {
  const { state, dispatch } = useContext(AppContext);
  const [doc, setDoc]       = useState(null);
  const [showOCR, setShowOCR] = useState(false);
  const [fileUrl, setFileUrl] = useState(null);

  useEffect(() => {
    if (docId == null) return;
    const cached = state.documents.find(d => d.id === docId);
    if (cached) { 
      setDoc(cached); 
    } else {
      getDocumentById(docId).then(setDoc);
    }
  }, [docId, state.documents]);

  useEffect(() => {
    if (doc?.file_data) {
      const url = URL.createObjectURL(doc.file_data);
      setFileUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [doc]);

  if (!doc) return <div className="page-container"><p className="muted">{t('detail.loading')}</p></div>;

  async function handleDelete() {
    if (!window.confirm(t('settings.clear_confirm'))) return;
    await deleteDocument(doc.id);
    dispatch({ type: 'REMOVE_DOCUMENT', id: doc.id });
    dispatch({ type: 'SET_VIEW', view: 'dashboard' });
  }

  async function handleToggleDone() {
    let note = doc.done_note || '';
    if (!doc.is_done) {
      const input = window.prompt(t('detail.done_note_prompt'));
      if (input === null) return; // Cancelled
      note = input;
    }
    const updated = { ...doc, is_done: !doc.is_done, done_note: note };
    await updateDocument(updated);
    setDoc(updated);
    dispatch({ type: 'UPDATE_DOCUMENT', document: updated });
  }

  const goBack = () => dispatch({ type: 'SET_VIEW', view: 'dashboard' });

  // 🛡️ Bulletproof renderer helper for action steps (handles strings, arrays, or objects safely)
  const renderActionSteps = (steps) => {
    if (!steps) return null;
    if (typeof steps === 'string') return <p style={{ whiteSpace: 'pre-line' }}>{steps}</p>;
    if (Array.isArray(steps)) {
      return (
        <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
          {steps.map((item, idx) => (
            <li key={idx} style={{ marginBottom: '0.35rem' }}>
              {typeof item === 'string' ? item : (item.step || item.action || JSON.stringify(item))}
              {item.date && <span className="muted"> (Date: {item.date})</span>}
              {item.time && <span className="muted"> (Time: {item.time})</span>}
            </li>
          ))}
        </ul>
      );
    }
    if (typeof steps === 'object') {
      return <p>{Object.entries(steps).map(([k, v]) => `${k}: ${v}`).join(' — ')}</p>;
    }
    return <p>{String(steps)}</p>;
  };

  return (
    <div className="page-container">
      <button className="btn btn-outline" onClick={goBack} style={{ alignSelf: 'flex-start' }}>
        ← {t('detail.back')}
      </button>

      <div className="detail-header">
        <h1 className="page-title">{doc.file_name}</h1>
        <span className={`urgency-badge urgency-badge--${doc.urgency}`}>{doc.urgency}</span>
      </div>

      <div className="detail-layout">
        <div className="detail-info">
          <div className="detail-card" style={{ marginBottom: '1.25rem' }}>
            <h2>📋 {t('detail.summary')}</h2>
            <p style={{ whiteSpace: 'pre-line' }}>
              {typeof doc.summary === 'string' ? doc.summary : (doc.summary ? JSON.stringify(doc.summary) : t('detail.none_saved'))}
            </p>
          </div>

          {doc.action_steps && (
            <div className="detail-card detail-card--action" style={{ marginBottom: '1.25rem' }}>
              <h2>✅ {t('detail.steps')}</h2>
              {renderActionSteps(doc.action_steps)}
            </div>
          )}

          <div className="detail-card" style={{ marginBottom: '1.25rem' }}>
            <table className="detail-table">
              <tbody>
                <Row label={t('detail.sender')}   value={doc.sender}        bold />
                <Row label={t('detail.type')}     value={t(`categories.${doc.document_type}`) || doc.document_type} />
                <Row label={t('detail.category')} value={doc.sub_category ? `${t(`categories.${doc.main_category}`)} › ${t(`categories.${doc.sub_category}`)}` : t(`categories.${doc.main_category}`)} />
                {doc.dates?.document_date && <Row label={t('detail.date')} value={doc.dates.document_date} />}
                {doc.dates?.due_date && <Row label={t('detail.due_date')} value={doc.dates.due_date} bold />}
                {doc.money?.amount != null && (
                  <Row
                    label={t('detail.amount')}
                    value={`${doc.money.amount} ${doc.money.currency || 'EUR'}`}
                    bold
                  />
                )}
                <Row label={t('detail.action')} value={t(`actions.${doc.action_required}`) || doc.action_required} />
              </tbody>
            </table>
          </div>

          <div className="detail-card" style={{ marginBottom: '1.25rem', borderLeft: doc.is_done ? '4px solid var(--c-informational)' : '4px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h2 style={{ marginBottom: '0.25rem', fontSize: '1rem' }}>{doc.is_done ? `✅ ${t('detail.mark_done')}` : `⏳ ${t('detail.pending')}`}</h2>
                {doc.is_done && doc.done_note && <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>{t('detail.done_note_label')}{doc.done_note}</p>}
                {!doc.is_done && generateGoogleCalendarUrl(doc) && (
                  <a
                    href={generateGoogleCalendarUrl(doc)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-outline btn-sm"
                    style={{ marginTop: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', fontSize: '0.8rem' }}
                  >
                    📅 {t('detail.calendar_add')}
                  </a>
                )}
              </div>
              <button className={`btn ${doc.is_done ? 'btn-outline' : 'btn-primary'}`} onClick={handleToggleDone}>
                {doc.is_done ? t('detail.mark_pending') : t('detail.mark_done')}
              </button>
            </div>
          </div>

          <button className="btn btn-outline" onClick={() => setShowOCR(v => !v)} style={{ marginBottom: '1rem', width: '100%' }}>
            {showOCR ? t('detail.hide_ocr') : t('detail.show_ocr')}
          </button>
          
          {showOCR && <div className="ocr-box"><pre>{doc.ocr_text}</pre></div>}
          
          <button className="btn btn-danger" onClick={handleDelete} style={{ marginTop: '1rem', width: '100%' }}>
            🗑️ {t('detail.delete')}
          </button>
        </div>

        <div className="detail-preview">
          {fileUrl ? (
            doc.file_type === 'image' ? <img src={fileUrl} alt="Original Document" className="doc-preview-media" /> : <iframe src={fileUrl} title="Original Document" className="doc-preview-media" />
          ) : (
            <div className="detail-card"><p className="muted">No original file saved for this document.</p></div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }) {
  if (!value) return null;
  return <tr><td className="detail-table__label">{label}</td><td className={bold ? 'detail-table__val--bold' : ''}>{value}</td></tr>;
}
