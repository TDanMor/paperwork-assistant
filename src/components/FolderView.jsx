import React, { useContext, useState } from 'react';
import { AppContext } from '../App.jsx';
import { t } from '../i18n/index.js';

const MAIN_CATS = ['Insurance','Finance','Government','Healthcare','Housing','Employment','Utility','Other'];
const MONTH_KEYS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

export default function FolderView() {
  const { state, dispatch } = useContext(AppContext);
  const { documents } = state;
  const monthNames = MONTH_KEYS.map(m => t(`months.${m}`));

  const [path, setPath] = useState({ cat: null, sub: null, year: null, month: null });
  const [searchQuery, setSearchQuery] = useState('');

  function nav(updates) { setPath(prev => ({ ...prev, ...updates })); }

  function goBack() {
    if (path.month !== null) return nav({ month: null });
    if (path.year !== null) return nav({ year: null });
    if (path.sub !== null) return nav({ sub: null });
    if (path.cat !== null) return nav({ cat: null });
  }

  // If searching, show the global search results and bypass the folders
  if (searchQuery.trim().length > 0) {
    const lowerQ = searchQuery.toLowerCase();
    const results = documents.filter(d =>
      (d.file_name || '').toLowerCase().includes(lowerQ) ||
      (d.sender || '').toLowerCase().includes(lowerQ) ||
      (d.summary || '').toLowerCase().includes(lowerQ) ||
      (d.main_category || '').toLowerCase().includes(lowerQ) ||
      (d.sub_category || '').toLowerCase().includes(lowerQ)
    );

    return (
      <div className="page-container">
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <h1 className="page-title" style={{ flex: 1 }}>🔍 {t('folders.search_results')}</h1>
          <input type="text" placeholder={`${t('folders.search_placeholder')}...`} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ padding: '0.6rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', width: '100%', maxWidth: '300px', fontSize: '0.9rem' }} autoFocus />
        </div>
        <div className="doc-list">
          {results.length === 0 ? <p className="empty-state">{t('folders.no_matches')}</p> : results.map(doc => (
            <div key={doc.id} className="doc-row" onClick={() => dispatch({ type:'SET_VIEW', view:'detail', docId: doc.id })}>
              <span className="doc-row__name">{doc.is_done ? "✅ " : ""}{doc.file_name}</span>
              <span className="doc-row__sender muted">{doc.sender}</span>
              <span className={`urgency-badge urgency-badge--${doc.urgency}`}>{doc.urgency}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Normal folder logic
  let filtered = documents;
  if (path.cat)   filtered = filtered.filter(d => d.main_category === path.cat);
  if (path.sub)   filtered = filtered.filter(d => d.sub_category  === path.sub);
  if (path.year)  filtered = filtered.filter(d => d.year  === path.year);
  if (path.month !== null) filtered = filtered.filter(d => d.month === path.month);

  const unique = key => [...new Set(filtered.map(d => d[key]).filter(Boolean))];
  const subs   = unique('sub_category');
  const years  = unique('year').sort((a, b) => b - a);
  const months = unique('month').sort((a, b) => a - b);

  const level = path.month !== null ? 'docs' : path.year !== null ? 'months' : path.sub !== null ? 'years' : path.cat !== null ? 'subs' : 'cats';

  return (
    <div className="page-container">
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ flex: 1 }}>{t('folders.title')}</h1>
        <input type="text" placeholder={t('folders.search_placeholder')} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ padding: '0.6rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', width: '100%', maxWidth: '300px', fontSize: '0.9rem' }} />
      </div>

      {path.cat && (
        <button className="btn btn-outline" onClick={goBack} style={{ alignSelf: 'flex-start', marginBottom: '-0.5rem', padding: '0.3rem 0.8rem', fontSize: '0.85rem' }}>
          ← {t('detail.back')}
        </button>
      )}

      <nav className="breadcrumb">
        <button onClick={() => setPath({ cat:null, sub:null, year:null, month:null })}>{t('folders.all')}</button>
        {path.cat && <><span aria-hidden>›</span><button onClick={() => nav({ sub:null, year:null, month:null })}>{t(`categories.${path.cat}`)}</button></>}
        {path.sub && <><span aria-hidden>›</span><button onClick={() => nav({ year:null, month:null })}>{t(`categories.${path.sub}`) || path.sub}</button></>}
        {path.year && <><span aria-hidden>›</span><button onClick={() => nav({ month:null })}>{path.year}</button></>}
        {path.month !== null && <><span aria-hidden>›</span><span>{monthNames[path.month - 1]}</span></>}
      </nav>

      {level === 'cats' && <div className="folder-grid">{MAIN_CATS.map(cat => <FolderBtn key={cat} icon="📁" label={t(`categories.${cat}`)} count={documents.filter(d => d.main_category === cat).length} onClick={() => nav({ cat })} />)}</div>}
      {level === 'subs' && <div className="folder-grid">{subs.map(sub => <FolderBtn key={sub} icon="📂" label={t(`categories.${sub}`) || sub} count={filtered.filter(d => d.sub_category === sub).length} onClick={() => nav({ sub })} />)}</div>}
      {level === 'years' && <div className="folder-grid">{years.map(year => <FolderBtn key={year} icon="📅" label={String(year)} count={filtered.filter(d => d.year === year).length} onClick={() => nav({ year })} />)}</div>}
      {level === 'months' && <div className="folder-grid">{months.map(m => <FolderBtn key={m} icon="🗓️" label={monthNames[m - 1]} count={filtered.filter(d => d.month === m).length} onClick={() => nav({ month: m })} />)}</div>}
      {level === 'docs' && (
        <div className="doc-list">
          {filtered.length === 0 ? <p className="empty-state">{t('folders.no_docs')}</p> : filtered.map(doc => (
            <div key={doc.id} className="doc-row" onClick={() => dispatch({ type:'SET_VIEW', view:'detail', docId: doc.id })}>
              <span className="doc-row__name">{doc.is_done ? "✅ " : ""}{doc.file_name}</span>
              <span className="doc-row__sender muted">{doc.sender}</span>
              <span className={`urgency-badge urgency-badge--${doc.urgency}`}>{doc.urgency}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FolderBtn({ icon, label, count, onClick }) {
  return (
    <button className="folder-btn" onClick={onClick}>
      <span className="folder-btn__icon">{icon}</span>
      <span className="folder-btn__label">{label}</span>
      {count > 0 && <span className="folder-btn__count">{count}</span>}
    </button>
  );
}
