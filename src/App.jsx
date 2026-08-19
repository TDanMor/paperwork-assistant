// App.jsx — Root component. Holds all global state in a single useReducer.
import React, {
  createContext, useContext, useReducer, useEffect,
} from 'react';
import NavBar          from './components/NavBar.jsx';
import ModelLoader     from './components/ModelLoader.jsx';
import Dashboard       from './components/Dashboard.jsx';
import Upload          from './components/Upload.jsx';
import FolderView      from './components/FolderView.jsx';
import DocumentDetail  from './components/DocumentDetail.jsx';
import Settings        from './components/Settings.jsx';
import VaultLock       from './components/VaultLock.jsx';
import { getAllDocuments } from './storage/db.js';
import { setLanguage }    from './i18n/index.js';

// ---------- Context (shared with all child components) ----------
export const AppContext = createContext(null);

// ---------- Initial state ----------
const initialState = {
  language:      localStorage.getItem('pa_lang') || 'en',
  modelStatus:   'idle',   // idle | loading | ready | error
  modelProgress: 0,        // 0–100
  modelMessage:  '',       // status text from WebLLM
  view:          'dashboard', // dashboard | upload | folders | detail | settings
  selectedDocId: null,     // id of document shown in detail view
  documents:     [],       // all docs loaded from IndexedDB
  isUploading:   false,
  isVaultLocked: true,     // 🔐 NEW: Track if the user has entered their PIN
};

// ---------- Reducer — one place to update state ----------
function reducer(state, action) {
  switch (action.type) {
    case 'SET_LANGUAGE':
      localStorage.setItem('pa_lang', action.payload);
      return { ...state, language: action.payload };

    case 'SET_VAULT_LOCKED':
      return { ...state, isVaultLocked: action.payload };

    case 'SET_MODEL_STATUS':
      return {
        ...state,
        modelStatus:   action.status,
        modelProgress: action.progress ?? state.modelProgress,
        modelMessage:  action.message  ?? state.modelMessage,
      };

    case 'SET_VIEW':
      return { ...state, view: action.view, selectedDocId: action.docId ?? null };

    case 'SET_UPLOADING':
      return { ...state, isUploading: action.payload };

    case 'SET_DOCUMENTS':
      return { ...state, documents: action.documents };

    case 'ADD_DOCUMENT':
      return { ...state, documents: [action.document, ...state.documents] };

    case 'UPDATE_DOCUMENT':
      return { ...state, documents: state.documents.map(d => d.id === action.document.id ? action.document : d) };

    case 'REMOVE_DOCUMENT':
      return {
        ...state,
        documents: state.documents.filter(d => d.id !== action.id),
      };

    default:
      return state;
  }
}

// ---------- App ----------
export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Load all documents from IndexedDB when the app first mounts
  useEffect(() => {
    getAllDocuments()
      .then(docs => dispatch({ type: 'SET_DOCUMENTS', documents: docs }))
      .catch(err  => console.error('Failed to load documents:', err));
  }, []);

  // Sync language helper whenever it changes
  useEffect(() => {
    setLanguage(state.language);
    document.documentElement.lang = state.language;
  }, [state.language]);

  // Simple view router — no external router library needed for this size
  const renderView = () => {
    switch (state.view) {
      case 'dashboard': return <Dashboard />;
      case 'upload':    return <Upload />;
      case 'folders':   return <FolderView />;
      case 'history':   return <HistoryView />;
      case 'timeline':  return <TimelineView />;
      case 'detail':    return <DocumentDetail docId={state.selectedDocId} />;
      case 'settings':  return <Settings />;
      default:          return <Dashboard />;
    }
  };

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <div className="app-wrapper">
        {/* Model loading banner — visible unless model is ready */}
        {state.modelStatus !== 'ready' && <ModelLoader />}

        <NavBar />

        <main className="main-content">
          {state.isVaultLocked ? <VaultLock /> : renderView()}
        </main>
      </div>
    </AppContext.Provider>
  );
}






