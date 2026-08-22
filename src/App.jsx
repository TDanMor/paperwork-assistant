// App.jsx — Root component. Holds all global state in a single useReducer.
import React, {
  createContext, useContext, useReducer, useEffect,
} from 'react';
import NavBar          from './components/NavBar.jsx';
import ModelLoader     from './components/ModelLoader.jsx';
import Dashboard       from './components/Dashboard.jsx';
import Upload          from './components/Upload.jsx';
import FolderView      from './components/FolderView.jsx';
import TimelineView    from './components/TimelineView.jsx';
import HistoryView     from './components/HistoryView.jsx';
import DocumentDetail  from './components/DocumentDetail.jsx';
import Settings        from './components/Settings.jsx';
import VaultLock       from './components/VaultLock.jsx';
import InstallBanner   from './components/InstallBanner.jsx';
import Onboarding      from './components/Onboarding.jsx';
import { hasCachedProfile } from './ai/hardware.js';
import { getAllDocuments, setSessionKey, tryRestoreSession } from './storage/db.js';
import { setLanguage }    from './i18n/index.js';
import { initializeHardware, activeHardwareProfile } from './ai/engine.js';

// ---------- Context (shared with all child components) ----------
export const AppContext = createContext(null);

const LOCK_AFTER_MS = 30 * 60 * 1000; // Increased to 30 Minutes for better UX

// ---------- Initial state ----------
const initialState = {
  language:      localStorage.getItem('pa_lang') || 'en',
  modelStatus:   'checking_hardware',   // checking_hardware | idle | loading | ready | error | ready_deterministic
  showOnboarding: !hasCachedProfile(),
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
    case 'FINISH_ONBOARDING':
      return { ...state, showOnboarding: false };

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
  const lockTimerRef = React.useRef(null);

  // 🔐 INACTIVITY AUTO-LOCK
  const resetLockTimer = React.useCallback(() => {
    if (state.isVaultLocked) return;

    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);

    lockTimerRef.current = setTimeout(() => {
      setSessionKey(null); // Wipe key from memory and sessionStorage
      dispatch({ type: 'SET_VAULT_LOCKED', payload: true });
    }, LOCK_AFTER_MS);
  }, [state.isVaultLocked]);

  // 🔐 SESSION RESTORATION (Survives Refresh)
  useEffect(() => {
    tryRestoreSession().then(restored => {
      if (restored) {
        dispatch({ type: 'SET_VAULT_LOCKED', payload: false });
        getAllDocuments().then(docs => dispatch({ type: 'SET_DOCUMENTS', documents: docs }));
      }
    });
  }, []);

  useEffect(() => {
    const handleActivity = () => resetLockTimer();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') resetLockTimer();
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('visibilitychange', handleVisibility);

    resetLockTimer(); // Start/Reset timer on mount or state change

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('visibilitychange', handleVisibility);
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    };
  }, [resetLockTimer]);

  // Load all documents from IndexedDB when the app first mounts
  useEffect(() => {
    getAllDocuments()
      .then(docs => dispatch({ type: 'SET_DOCUMENTS', documents: docs }))
      .catch(err  => console.error('Failed to load documents:', err));
  }, []);

  // Initialize hardware capabilities
  useEffect(() => {
    if (!state.showOnboarding) {
      initializeHardware().then(() => {
        if (activeHardwareProfile && activeHardwareProfile.tier === 'NO_LOCAL') {
          dispatch({ type: 'SET_MODEL_STATUS', status: 'ready_deterministic', message: '' });
        } else {
          dispatch({ type: 'SET_MODEL_STATUS', status: 'idle', message: '' });
        }
      });
    }
  }, [state.showOnboarding]);

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
        {/* Onboarding Screen */}
        {state.showOnboarding && (
          <Onboarding onFinish={() => {
            dispatch({ type: 'SET_MODEL_STATUS', status: activeHardwareProfile?.tier === 'NO_LOCAL' ? 'ready_deterministic' : 'idle', message: '' });
            dispatch({ type: 'FINISH_ONBOARDING' });
          }} />
        )}

          {/* Model loading banner — visible unless model is ready */}
          {(state.modelStatus !== 'ready' && state.modelStatus !== 'ready_deterministic') && <ModelLoader />}

          <NavBar />

          <main className="main-content">
            {state.isVaultLocked ? <VaultLock /> : renderView()}
          </main>
        
          <InstallBanner />
      </div>
    </AppContext.Provider>
  );
}






