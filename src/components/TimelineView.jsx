import React, { useContext } from 'react';
import { AppContext } from '../App.jsx';
import { t } from '../i18n/index.js';

export default function TimelineView() {
  const { state, dispatch } = useContext(AppContext);
  const docs = state.documents;

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // Bucket documents by timeframe based on due_date or document_date or creation date
  const buckets = {
    upcomingMonth: [],
    thisMonth: [],
    older: []
  };

  docs.forEach(doc => {
    const dateStr = doc.dates?.due_date || doc.dates?.document_date || doc.created_at;
    const d = new Date(dateStr);
    const docMonth = d.getMonth();
    const docYear = d.getFullYear();

    if (isNaN(d.getTime())) {
      buckets.older.push(doc);
    } else if (docYear === currentYear && docMonth === currentMonth + 1) {
      buckets.upcomingMonth.push(doc);
    } else if (docYear === currentYear && docMonth === currentMonth) {
      buckets.thisMonth.push(doc);
    } else {
      buckets.older.push(doc);
    }
  });

  return (
    <div className="page-container">
      <h1 className="page-title">📅 {t('timeline_view.title')}</h1>
      <p className="muted" style={{ marginTop: '-0.75rem' }}>{t('timeline_view.subtitle')}</p>

      {docs.length === 0 ? (
        <div className="empty-state"><p>📭 {t('timeline_view.no_docs')}</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {buckets.upcomingMonth.length > 0 && (
            <section className="dash-section">
              <h2 className="dash-section__heading" style={{ color: 'var(--c-upcoming)' }}>🚀 {t('timeline_view.next_month')}</h2>
              <div className="doc-list">
                {buckets.upcomingMonth.map(doc => <TimelineRow key={doc.id} doc={doc} dispatch={dispatch} />)}
              </div>
            </section>
          )}

          {buckets.thisMonth.length > 0 && (
            <section className="dash-section">
              <h2 className="dash-section__heading" style={{ color: 'var(--c-urgent)' }}>📌 {t('timeline_view.this_month')}</h2>
              <div className="doc-list">
                {buckets.thisMonth.map(doc => <TimelineRow key={doc.id} doc={doc} dispatch={dispatch} />)}
              </div>
            </section>
          )}

          {buckets.older.length > 0 && (
            <section className="dash-section">
              <h2 className="dash-section__heading" style={{ color: 'var(--muted)' }}>🗄️ {t('timeline_view.past_archive')}</h2>
              <div className="doc-list">
                {buckets.older.map(doc => <TimelineRow key={doc.id} doc={doc} dispatch={dispatch} />)}
              </div>
            </section>
          )}

        </div>
      )}
    </div>
  );
}

function TimelineRow({ doc, dispatch }) {
  const displayDate = doc.dates?.due_date || doc.dates?.document_date || doc.created_at?.slice(0, 10) || '';
  return (
    <div className="doc-row" onClick={() => dispatch({ type:'SET_VIEW', view:'detail', docId: doc.id })}>
      <span className="doc-row__name">{doc.is_done ? "✅ " : ""}{doc.file_name}</span>
      <span className="doc-row__sender muted">{doc.sender}</span>
      {displayDate && <span className="muted" style={{ fontSize: '0.85rem' }}>📅 {displayDate}</span>}
      <span className={`urgency-badge urgency-badge--${doc.urgency}`}>{doc.urgency}</span>
    </div>
  );
}
