#!/usr/bin/env node
/* DocAgent supervisor — starts Express + Vite as children, exits when
 * either child exits or when heartbeat times out (browser tab closed). */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const VITE = path.join(ROOT, 'client', 'node_modules', '.bin', 'vite');
const LOG_DIR = path.join(ROOT, 'data', 'logs');

fs.mkdirSync(LOG_DIR, { recursive: true });

const serverLog = fs.openSync(path.join(LOG_DIR, 'server.log'), 'w');
const clientLog = fs.openSync(path.join(LOG_DIR, 'client.log'), 'w');

const server = spawn(TSX, ['src/server/app.ts'], {
  cwd: ROOT,
  stdio: ['ignore', serverLog, serverLog],
  env: { ...process.env, FORCE_COLOR: '0' },
});

const vite = spawn(VITE, [], {
  cwd: path.join(ROOT, 'client'),
  stdio: ['ignore', clientLog, clientLog],
  env: { ...process.env, FORCE_COLOR: '0' },
});

console.log(`[supervisor] server pid=${server.pid}  vite pid=${vite.pid}`);

let shuttingDown = false;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[supervisor] shutting down: ${reason}`);
  try { server.kill('SIGTERM'); } catch {}
  try { vite.kill('SIGTERM'); } catch {}
  setTimeout(() => {
    try { server.kill('SIGKILL'); } catch {}
    try { vite.kill('SIGKILL'); } catch {}
    process.exit(0);
  }, 1500);
}

server.on('exit', (code) => shutdown(`server exited (${code})`));
vite.on('exit',   (code) => shutdown(`vite exited (${code})`));

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
