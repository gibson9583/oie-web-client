#!/usr/bin/env node
/*
 * OIE Web Administrator — standalone NodeJS server.
 *
 * Serves the single-page web administrator, reverse-proxies the engine REST
 * API at /api, and loads web admin plugins. See ../README.md.
 */

'use strict';

const path = require('path');
const express = require('express');

const { load } = require('./config');
const { createApiProxy } = require('./proxy');
const plugins = require('./plugins');
const { installSerialize } = require('./serialize');

const config = load();
const app = express();

app.disable('x-powered-by');

// --- Engine REST API proxy ---------------------------------------------------
app.use('/api', createApiProxy(config));

// --- Web admin metadata ------------------------------------------------------
app.get('/webadmin/config.json', (req, res) => {
    res.json({ engineUrl: config.engine.url, version: require('../package.json').version });
});

// --- Serializer bridge (optional, exact datatype serialization) --------------
const serializerBridge = installSerialize(app, config);

// --- Plugins -----------------------------------------------------------------
const loaded = plugins.install(app, config);

// --- Static frontend ---------------------------------------------------------
const clientDir = path.join(config.root, 'client');
app.use(express.static(clientDir));

// SPA fallback: any other GET renders the app shell (hash routing handles views).
app.get('*', (req, res) => res.sendFile(path.join(clientDir, 'index.html')));

app.listen(config.port, config.host, () => {
    console.log('');
    console.log('  Open Integration Engine — Web Administrator');
    console.log('  --------------------------------------------');
    console.log(`  UI:      http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
    console.log(`  Engine:  ${config.engine.url} (TLS verify: ${config.engine.verifyTls})`);
    console.log(`  Plugins: ${loaded.length} loaded from ${config.pluginDir}`);
    const sb = serializerBridge.status();
    console.log(`  Serializer bridge: ${sb.configured ? `enabled (engine: ${sb.engineHome})` : 'disabled — using built-in JS parsing (set OIE_HOME for exact serialization)'}`);
    console.log('');
});
