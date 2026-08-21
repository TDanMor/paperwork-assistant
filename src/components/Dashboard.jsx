import React, { useContext, useState } from 'react';
import { AppContext } from '../App.jsx';
import TaskTile from './TaskTile.jsx';
import GpuGuard from './GpuGuard.jsx';
import { t } from '../i18n/index.js';

const URGENCY_ORDER = ['overdue', 'urgent', 'upcoming', 'informational'];

export default function Dashboard() {
  const { state } = useContext(AppContext);
  const { documents } = state;

  const grouped = Object.fromEntries(
    URGENCY_ORDER.map(u => [u, documents.filter(d => d.urgency === u && !d.is_done)])
  );

  // Automatically open columns that have items, collapse empty ones
  const [openCols, setOpenCols] = useState({
    overdue: grouped.overdue.length > 0,
    urgent: grouped.urgent.length > 0,
    upcoming: grouped.upcoming.length > 0,
    informational: grouped.informational.length > 0
  });

  function toggleCol(urg) {
    setOpenCols(prev => ({ ...prev, [urg]: !prev[urg] }));
  }

  const totalActive = Object.values(grouped).reduce((acc, arr) => acc + arr.length, 0);
  const isEmpty = totalActive === 0 && documents.length === 0;

  // Generate an intuitive, human-friendly summary sentence
  let summaryText = t('dashboard.clean_desk');
  if (totalActive > 0) {
    const parts = [];
    if (grouped.overdue.length > 0) parts.push(t('dashboard.summary_overdue').replace('{count}', grouped.overdue.length));
    if (grouped.urgent.length > 0) parts.push(t('dashboard.summary_urgent').replace('{count}', grouped.urgent.length));
    if (grouped.upcoming.length > 0) parts.push(t('dashboard.summary_upcoming').replace('{count}', grouped.upcoming.length));
    if (grouped.informational.length > 0) parts.push(t('dashboard.summary_informational').replace('{count}', grouped.informational.length));

    // Simple pluralization for English/Romanian style (s) and German style (e/s)
    const suffix = state.language === 'de' ? (totalActive === 1 ? 's' : '') : (totalActive === 1 ? '' : 's');
    const pluralSuffix = state.language === 'de' ? (totalActive === 1 ? '' : 'e') : (totalActive === 1 ? '' : 's');

    summaryText = t('dashboard.summary_prefix')
      .replace('{total}', totalActive)
      .replace('{suffix}', suffix)
      .replace('{plural_suffix}', pluralSuffix)
      + ' ' + parts.join(', ') + '.';
  }

  return (
    <div className="page-container" style={{ maxWidth: '100%' }}>
      <h1 className="page-title">{t('dashboard.title')}</h1>

      {/* Intuitive Human Summary Banner */}
      <div className="summary-banner" style={{ boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
        <span style={{ fontSize: '1.5rem' }}>💡</span>
        <div>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.15rem 0' }}>{t('dashboard.workspace_briefing')}</h2>
          <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>{summaryText}</p>
        </div>
      </div>

      {isEmpty ? (
        <div className="empty-state">
          <p>📭 {t('dashboard.no_tasks')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {URGENCY_ORDER.map(urg => {
            const count = grouped[urg].length;
            if (count === 0) return null; // Don't show empty sections in this layout

            // Map urgency to corresponding icon and symbol
            const urgConfig = {
              overdue: { icon: '⚠', symbol: '— Act now' },
              urgent: { icon: '●', symbol: '— This week' },
              upcoming: { icon: '○', symbol: '— Plan ahead' },
              informational: { icon: '✓', symbol: '— No action needed' }
            };

            return (
              <div key={urg} className="section" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                <div className={`dash-section__heading urgency-heading--${urg}`}>
                  {urgConfig[urg].icon} {t(`dashboard.sections.${urg}`)} {urgConfig[urg].symbol}
                </div>
                <div className="tile-grid">
                  {grouped[urg].map(doc => <TaskTile key={doc.id} doc={doc} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
