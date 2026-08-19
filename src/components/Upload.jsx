import React, { useContext, useState, useRef } from 'react';
import { AppContext }       from '../App.jsx';
import { processFile }      from '../ocr/processor.js';
import { isModelLoaded, chat, getTokenCount } from '../ai/engine.js';
import { buildSystemPrompt, buildUserMessage, parseAIResponse, getFallbackData, smartSliceOCR } from '../ai/prompts.js';
import { saveDocument }     from '../storage/db.js';
import { t }                from '../i18n/index.js';

export default function Upload() {
  const { state, dispatch } = useContext(AppContext);
  const [queue, setQueue]       = useState([]);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);

  async function handleFilesSelected(files) {
    if (!files || files.length === 0) return;

    const newItems = Array.from(files).map((file, index) => ({
      id: Date.now() + index,
      file,
      name: file.name,
      status: 'pending',
      progress: 0,
      errorMsg: '',
      savedDoc: null,
      aiFailed: false
    }));

    setQueue(prev => [...prev, ...newItems]);
    dispatch({ type: 'SET_UPLOADING', payload: true });

    // 🚀 SEQUENTIAL PROCESSING
    for (const item of newItems) {
      try {
        // Step 1: OCR
        updateItem(item.id, { status: 'processing_ocr', progress: 15 });
        const ocrText = await processFile(item.file, pct => updateItem(item.id, { progress: 15 + Math.round(pct * 0.4) }));

        // Step 2: AI Analysis (With Patient Auto-Retry)
        let aiData = null;
        let retryCount = 0;
        const maxRetries = 2;
        let wasAiSuccess = false;

        while (retryCount <= maxRetries) {
          // A. Wait for Readiness
          let waitSeconds = 0;
          while (!isModelLoaded() && waitSeconds < 60) {
            if (state.modelStatus === 'error') {
              dispatch({ type: 'SET_MODEL_STATUS', status: 'idle', message: t('upload.gpu_reset') });
            }
            updateItem(item.id, { status: 'processing_ai', progress: 65, errorMsg: t('upload.waiting_gpu') });
            await new Promise(r => setTimeout(r, 2000));
            waitSeconds += 2;
          }

          // B. Attempt Analysis
          try {
            updateItem(item.id, { status: 'processing_ai', progress: 80, errorMsg: retryCount > 0 ? `Retrying (${retryCount})...` : '' });

            const sys = buildSystemPrompt(state.language);

            // 🛡️ DYNAMIC CONTEXT PRUNING:
            // On a retry, we aggressively shrink the context to guarantee VRAM safety.
            const budgetLimit = retryCount > 0 ? 1200 : 2500;
            const text = smartSliceOCR(ocrText, budgetLimit);

            const user = buildUserMessage(text, state.language);

            const raw  = await chat(sys, user);
            aiData = parseAIResponse(raw, ocrText);

            wasAiSuccess = true;
            break;
          } catch (aiErr) {
            console.error(`AI Attempt ${retryCount + 1} failed:`, aiErr);
            if (!isModelLoaded()) {
              dispatch({ type: 'SET_MODEL_STATUS', status: 'idle', message: 'GPU reset. Recovering...' });
              await new Promise(r => setTimeout(r, 3000));
              retryCount++;
              continue;
            }
            break;
          }
        }

        if (!wasAiSuccess) {
          aiData = getFallbackData();
          updateItem(item.id, { aiFailed: true });
        }

        // Step 3: Saving
        updateItem(item.id, { status: 'saving', progress: 95, errorMsg: '' });
        const now = new Date();
        const doc = {
          file_name: item.file.name,
          file_type: item.file.type.startsWith('image/') ? 'image' : 'pdf',
          file_data: item.file,
          ocr_text:  ocrText,
          ...aiData,
          created_at: now.toISOString(),
          year:       now.getFullYear(),
          month:      now.getMonth() + 1,
          language:   state.language,
          is_done:    false
        };

        const saved = await saveDocument(doc);
        dispatch({ type: 'ADD_DOCUMENT', document: saved });

        updateItem(item.id, { status: 'done', progress: 100, savedDoc: saved, errorMsg: '' });

      } catch (err) {
        console.error('Queue item failed:', err);
        updateItem(item.id, { status: 'error', errorMsg: err.message });
      }
    }

    dispatch({ type: 'SET_UPLOADING', payload: false });
  }

  function updateItem(id, updates) {
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    handleFilesSelected(e.dataTransfer.files);
  }

  function clearQueue() {
    setQueue([]);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="page-container">
      <h1 className="page-title">{t('upload.title')}</h1>

      <div
        className={`dropzone${dragging ? ' dropzone--over' : ''}`}
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onClick={() => fileRef.current?.click()}
      >
        <div className="dropzone__icon">📤</div>
        <p className="dropzone__hint">Drop multiple PDFs or images here, or click to browse</p>
        <button className="btn btn-primary" onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>
          {t('upload.select_file')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => handleFilesSelected(e.target.files)}
        />
      </div>

      {queue.length > 0 && (
        <div className="detail-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>📋 {t('upload.processing_queue')} ({queue.filter(q => q.status === 'done').length}/{queue.length})</h2>
            <button className="btn btn-outline btn-sm" onClick={clearQueue}>{t('upload.clear_queue')}</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {queue.map(item => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', gap: '1rem', flexWrap: 'wrap' }}>
                
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <p style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.2rem' }}>📄 {item.name}</p>
                  <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
                    {item.status === 'pending' && t('upload.status_pending')}
                    {item.status === 'processing_ocr' && t('upload.status_ocr')}
                    {item.status === 'processing_ai' && (item.errorMsg || t('upload.status_ai'))}
                    {item.status === 'saving' && t('upload.status_saving')}
                    {item.status === 'done' && t('upload.status_done')}
                    {item.status === 'error' && `${t('model.error')}: ${item.errorMsg}`}
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  {item.status !== 'done' && item.status !== 'error' && (
                    <div className="progress-wrap" style={{ width: '100px' }}>
                      <div className="progress-bar" style={{ width: `${item.progress}%` }} />
                    </div>
                  )}

                  {item.status === 'done' && item.savedDoc && (
                    <button className="btn btn-primary btn-sm" onClick={() => dispatch({ type: 'SET_VIEW', view: 'detail', docId: item.savedDoc.id })}>
                      {t('upload.view_details')}
                    </button>
                  )}

                  {item.status === 'error' && <span style={{ color: 'var(--c-overdue)', fontSize: '0.8rem', fontWeight: 700 }}>{t('upload.badge_failed')}</span>}
                  {item.status === 'done' && !item.aiFailed && <span style={{ color: 'var(--c-informational)', fontSize: '0.8rem', fontWeight: 700 }}>✅ {t('upload.badge_done')}</span>}
                  {item.status === 'done' && item.aiFailed && <span style={{ color: 'var(--c-urgent)', fontSize: '0.8rem', fontWeight: 700 }}>⚠️ {t('upload.badge_ai_unavailable')}</span>}
                </div>

              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
