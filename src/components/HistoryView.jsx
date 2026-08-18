import React, { useContext } from 'react';
import { AppContext } from '../App.jsx';

export default function HistoryView() {
  const { state, dispatch } = useContext(AppContext);
  const completedDocs = state.documents.filter(d => d.is_done);

  return (
    <div className="page-container">
      <h1 className="page-title">✅ Completed & Resolved History</h1>
      <p className="muted" style={{ marginTop: '-0.75rem' }}>Review all the paperwork you have successfully cleared out.</p>

      {completedDocs.length === 0 ? (
        <div className="empty-state">
          <p>📭 No completed tasks yet. Mark items as "Done" from their detail page to archive them here!</p>
        </div>
      ) : (
        <div className="doc-list">
          {completedDocs.map(doc => (
            <div key={doc.id} className="doc-row" onClick={() => dispatch({ type:'SET_VIEW', view:'detail', docId: doc.id })} style={{ borderLeft: '4px solid var(--c-informational)' }}>
              <span className="doc-row__name">✅ {doc.file_name}</span>
              <span className="doc-row__sender muted">{doc.sender}</span>
              {doc.done_note && <span className="muted" style={{ fontSize: '0.8rem', fontStyle: 'italic' }}>"{doc.done_note}"</span>}
              <span className="urgency-badge urgency-badge--informational">Done</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
