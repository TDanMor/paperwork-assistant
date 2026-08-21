import React, { useContext } from 'react';
import { AppContext } from '../App.jsx';
import { t } from '../i18n/index.js';

const URGENCY_CLASS = {
  overdue: 'b-ov',
  urgent: 'b-ur',
  upcoming: 'b-up',
  informational: 'b-in'
};

const ACTION_ICON = { pay:'💳', renew:'🔄', attend:'📅', respond:'📝', file:'📂', none:'✅' };

export default function TaskTile({ doc }) {
  const { dispatch } = useContext(AppContext);
  const badgeClass = URGENCY_CLASS[doc.urgency] || 'b-in';
  const icon = ACTION_ICON[doc.action_required] || '📄';

  return (
    <div
      className="tile"
      onClick={() => dispatch({ type: 'SET_VIEW', view: 'detail', docId: doc.id })}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && dispatch({ type: 'SET_VIEW', view: 'detail', docId: doc.id })}
    >
      <div className="tile-hd">
        <span className="tile-ico">{icon}</span>
        <span className="tile-sender" title={doc.sender || t('detail.unknown_sender')}>
          {doc.sender || t('detail.unknown_sender')}
        </span>
        <span className={`tile-badge ${badgeClass}`}>
          {t(`dashboard.sections.${doc.urgency}`)}
        </span>
      </div>

      <div className="tile-sum">{doc.summary || doc.file_name}</div>

      <div className="tile-meta">
        {doc.dates?.due_date && <span>📅 {t('detail.due_date')}: {doc.dates.due_date}</span>}
        {doc.money?.amount != null && <span>💶 {doc.money.amount} {doc.money.currency || 'EUR'}</span>}
      </div>
    </div>
  );
}
