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

/* Typed as the real react module so the .tsx panels get checked JSX and hook
   signatures; at runtime it is a Proxy over the host's platform.React. */
export const React: typeof import('react') = new Proxy({}, { get: (_t, key) => (platform.React as any)[key] }) as any;

export const useState: typeof import('react').useState = ((...a: any[]) => (platform.React as any).useState(...a)) as any;
export const useEffect: typeof import('react').useEffect = ((...a: any[]) => (platform.React as any).useEffect(...a)) as any;
export const useRef: typeof import('react').useRef = ((...a: any[]) => (platform.React as any).useRef(...a)) as any;
export const useReducer: typeof import('react').useReducer = ((...a: any[]) => (platform.React as any).useReducer(...a)) as any;
export const useMemo: typeof import('react').useMemo = ((...a: any[]) => (platform.React as any).useMemo(...a)) as any;
export const useCallback: typeof import('react').useCallback = ((...a: any[]) => (platform.React as any).useCallback(...a)) as any;
export const useLayoutEffect: typeof import('react').useLayoutEffect = ((...a: any[]) => (platform.React as any).useLayoutEffect(...a)) as any;
