import React, { useContext } from 'react';
import { AppContext } from '../App.jsx';
import { t } from '../i18n/index.js';

const URGENCY_STYLE = {
  overdue:       { border: '#dc2626', bg: '#fef2f2', label: '#dc2626' },
  urgent:        { border: '#f97316', bg: '#fff7ed', label: '#f97316' },
  upcoming:      { border: '#3b82f6', bg: '#eff6ff', label: '#3b82f6' },
  informational: { border: '#22c55e', bg: '#f0fdf4', label: '#22c55e' },
};

const ACTION_ICON = { pay:'💳', renew:'🔄', attend:'📅', respond:'📝', file:'📂', none:'✅' };

export default function TaskTile({ doc }) {
  const { dispatch } = useContext(AppContext);
  const style = URGENCY_STYLE[doc.urgency] || URGENCY_STYLE.informational;
  const icon  = ACTION_ICON[doc.action_required] || '📄';

  return (
    <div
      className="task-tile"
      style={{ backgroundColor: style.bg, borderLeft: `4px solid ${style.border}`, display: 'flex', flexDirection: 'column', height: '100%' }}
      onClick={() => dispatch({ type: 'SET_VIEW', view: 'detail', docId: doc.id })}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && dispatch({ type: 'SET_VIEW', view: 'detail', docId: doc.id })}
    >
      <div className="tile__header">
        <span className="tile__icon">{icon}</span>
        <span className="tile__sender">{doc.sender || 'Unknown'}</span>
        <span className="tile__cat" style={{ color: style.label }}>
          {t(`categories.${doc.main_category}`) || doc.main_category}
        </span>
      </div>

      <p className="tile__summary" style={{ flex: 1 }}>{doc.summary || doc.file_name}</p>

      <div className="tile__meta" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '0.85rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {doc.dates?.due_date && <span style={{ color: style.label, fontWeight: 600 }}>📅 {doc.dates.due_date}</span>}
          {doc.money?.amount != null && <span style={{ color: style.label, fontWeight: 600 }}>💰 {doc.money.amount} {doc.money.currency || ''}</span>}
        </div>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.25rem 0.5rem', borderRadius: '4px', backgroundColor: 'var(--surface)', border: `1px solid ${style.border}`, color: style.label, whiteSpace: 'nowrap' }}>
          ⏳ Pending Action
        </span>
      </div>
    </div>
  );
}
