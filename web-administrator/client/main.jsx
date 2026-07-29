/*
 * React entry point. Replaces app.js as the bundle entry (index.html). Mounts
 * the React <App> (auth gate → shell) into #app; the shell drives the existing
 * core/router.js and mounts the still-vanilla views during the migration.
 *
 * The shell root is wrapped in QueryClientProvider. Individual
 * views mount in their OWN React roots via react/mount.jsx, which wrap with the
 * same shared `queryClient` — so the server-state cache is shared app-wide.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './react/shell.jsx';
import { queryClient } from './react/queries.js';

// StrictMode covers the SHELL tree only. The per-view and per-island roots that
// react/mount.jsx creates are separate roots outside <App>, so they are NOT
// double-invoked by this — wrapping them too is a much riskier step, because the
// islands lean on mountReact's synchronous first render (see mount.jsx).
createRoot(document.getElementById('app')).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <App />
        </QueryClientProvider>
    </StrictMode>
);
