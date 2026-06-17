/*
 * React entry point. Replaces app.js as the bundle entry (index.html). Mounts
 * the React <App> (auth gate → shell) into #app; the shell drives the existing
 * core/router.js and mounts the still-vanilla views during the migration.
 */

import { createRoot } from 'react-dom/client';
import { App } from './react/shell.jsx';

createRoot(document.getElementById('app')).render(<App />);
