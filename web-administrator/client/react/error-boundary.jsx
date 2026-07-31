/*
 * Error boundaries — the app's answer to "a render threw".
 *
 * Without one, React unmounts the whole root that threw. The client runs several
 * roots (main.jsx: the shell; react/mount.jsx: one per view and one per hosted
 * island), so a throw does not blank the entire page — but it does empty whichever
 * root owns it, silently, leaving a blank region with no message and no way back
 * short of a reload. That matters most for the roots the app does not own: every
 * connector panel, settings tab, dashboard tab and attachment viewer is plugin
 * code mounted through mountReact.
 *
 * Three placements, matching the three root kinds:
 *
 *   reactView()   one per registered view      — rail/topbar survive, content reports
 *   mountReact()  one per hosted island        — the surrounding view survives
 *   main.jsx      the shell itself             — last resort; nothing else is left
 *
 * Retry remounts rather than re-renders: `resetKey` is bumped so children are
 * rebuilt from scratch, since a component that threw partway through mounting is
 * rarely fit to simply render again.
 */

import { Component } from 'react';
import { Icon } from './bridges.jsx';

/** Best-effort one-line summary of anything that can be thrown. */
function messageOf(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    return error.message || String(error);
}

/* The default fallback: an inline report sized to whatever region it replaces.
   `compact` is for hosted islands, which are often only a few hundred pixels. */
function DefaultFallback({ error, label, compact, onRetry }) {
    return (
        <div className={'view-error' + (compact ? ' compact' : '')} role="alert">
            <div className="view-error-head">
                <Icon name="warning" size={compact ? 15 : 18} />
                <span>{label}</span>
            </div>
            <div className="view-error-msg">{messageOf(error)}</div>
            <div className="view-error-actions">
                <button type="button" className="btn" onClick={onRetry}>
                    <Icon name="refresh" size={13} />Retry
                </button>
                {!compact && (
                    <button type="button" className="btn" onClick={() => location.reload()}>
                        Reload page
                    </button>
                )}
            </div>
        </div>
    );
}

export class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null, resetKey: 0 };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        // Keep the stack in the console: the fallback shows one line, and whoever
        // has to fix a plugin needs the component trace that goes with it.
        console.error(`[${this.props.label || 'ErrorBoundary'}]`, error, info?.componentStack);
        if (typeof this.props.onError === 'function') {
            try { this.props.onError(error, info); } catch { /* never mask the original */ }
        }
    }

    retry = () => this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));

    render() {
        const { error, resetKey } = this.state;
        const { children, label = 'This section failed to render', compact = false, fallback } = this.props;
        if (error) {
            if (typeof fallback === 'function') return fallback({ error, retry: this.retry });
            return <DefaultFallback error={error} label={label} compact={compact} onRetry={this.retry} />;
        }
        // Remount rather than re-render on retry.
        return <ErrorBoundaryChildren key={resetKey}>{children}</ErrorBoundaryChildren>;
    }
}

/* A plain pass-through whose only job is to carry the remount key, so `children`
   need not be cloned. */
function ErrorBoundaryChildren({ children }) {
    return children;
}
