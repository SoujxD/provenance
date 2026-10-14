import { createRoot } from 'react-dom/client';
import { StoreProvider } from './store';
import { App } from './App';
import { ensureWorkspace } from './api';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
ensureWorkspace()
  .then((ws) => root.render(<StoreProvider ws={ws}><App /></StoreProvider>))
  .catch((e) => root.render(<div className="empty">Could not start: {String(e.message || e)}</div>));
