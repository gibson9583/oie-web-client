/*
 * Lazy view of the host's React for raw-served connector modules.
 *
 * Connector panels are React but are served UNBUNDLED (the externalFramework
 * build keeps /connectors/*.js external, and the connector-* plugins load them
 * by URL). They can't `import 'react'` — react isn't in the page importmap —
 * and they may be evaluated before the shell sets platform.React at boot. This
 * module bridges both problems: `React` is a Proxy that forwards every property
 * access to platform.React at ACCESS time (i.e. at render, after boot), and the
 * hook exports are thin wrappers that call the real hook when invoked. So a
 * connector authors plain JSX + hooks (`import { React, useState } from
 * './react-platform.js'`), esbuild compiles JSX to React.createElement, and the
 * single host React instance is used — no second copy, no boot-order trap.
 */
import { platform } from '@oie/web-shell';

export const React = new Proxy({}, { get: (_t, key) => platform.React[key] });

export const useState = (...a) => platform.React.useState(...a);
export const useEffect = (...a) => platform.React.useEffect(...a);
export const useRef = (...a) => platform.React.useRef(...a);
export const useReducer = (...a) => platform.React.useReducer(...a);
export const useMemo = (...a) => platform.React.useMemo(...a);
export const useCallback = (...a) => platform.React.useCallback(...a);
export const useLayoutEffect = (...a) => platform.React.useLayoutEffect(...a);
