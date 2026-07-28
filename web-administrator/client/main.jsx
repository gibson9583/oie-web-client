/*
 * React entry point. Replaces app.js as the bundle entry (index.html). Mounts
 * the React <App> (auth gate → shell) into #app; the shell drives the existing
 * core/router.js and mounts the still-vanilla views during the migration.
 *
 * The shell root is wrapped in QueryClientProvider (Workstream A). Individual
 * views mount in their OWN React roots via react/mount.jsx, which wrap with the
 * same shared `queryClient` — so the server-state cache is shared app-wide.
 */

import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './react/shell.jsx';
import { queryClient } from './react/queries.js';

createRoot(document.getElementById('app')).render(
    <QueryClientProvider client={queryClient}>
        <App />
    </QueryClientProvider>
);
