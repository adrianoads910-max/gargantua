#!/usr/bin/env node
'use strict';
// gargantua [--demo] [--port 4848] [--no-open]
const { spawn } = require('child_process');
const { start } = require('../src/server');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const demo = args.includes('--demo');
const port = Number(opt('--port') ?? process.env.GARGANTUA_PORT ?? 4848);

start({ port, demo }).then(({ url }) => {
  console.log(`\n  🌌 Gargantua ${demo ? '(demo) ' : ''}em ${url}\n  Ctrl+C para sair.\n`);
  if (args.includes('--no-open')) return;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const a = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, a, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
}).catch(e => {
  console.error(e.code === 'EADDRINUSE' ? `A porta ${port} está ocupada. Use --port <outra>.` : e);
  process.exit(1);
});
