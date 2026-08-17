#!/usr/bin/env node
'use strict';

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.LAYOUT_PORT || 8899);
const TARGET = path.resolve(process.argv[2] || 'src/scene');
const LAYOUT_FILE = path.join(TARGET, 'layout.json');
const HISTORY_DIR = path.join(TARGET, 'layouts-history');
const CONFIG_FILE = path.resolve(TARGET, '..', 'game', 'config.ts');
const MAX_HISTORY = 50;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function ts() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function validate(layout) {
  if (!layout || typeof layout !== 'object') return 'layout 必须是 JSON 对象';
  const { room, placements } = layout;
  if (!room || typeof room.w !== 'number' || typeof room.h !== 'number') return 'room.w/h 必须是数字';
  if (room.w < 8 || room.w > 128 || room.h < 8 || room.h > 128) return 'room 范围 8~128';
  if (!Array.isArray(placements)) return 'placements 必须是数组';
  for (const p of placements) {
    if (!p || typeof p.kind !== 'string' || typeof p.x !== 'number' || typeof p.z !== 'number') {
      return 'placements 每项需 {kind,x,z}';
    }
  }
  return null;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value));
}

function replaceConstNumber(src, name, value) {
  const re = new RegExp(`(const\\s+${name}\\s*=\\s*)[-+]?\\d+(?:\\.\\d+)?`);
  return src.replace(re, `$1${formatNumber(value)}`);
}

function replaceSectionNumber(src, section, field, value) {
  const sectionRe = new RegExp(`(${section}:\\s*\\{)([\\s\\S]*?)(\\n\\s*\\},)`);
  return src.replace(sectionRe, (full, open, body, close) => {
    const fieldRe = new RegExp(`(\\n\\s*${field}:\\s*)[-+]?\\d+(?:\\.\\d+)?`);
    return open + body.replace(fieldRe, `$1${formatNumber(value)}`) + close;
  });
}

function syncConfig(room, tuning = {}) {
  try {
    let src = fs.readFileSync(CONFIG_FILE, 'utf8');
    const before = src;
    src = src.replace(/world:\s*\{\s*w:\s*\d+(?:\.\d+)?\s*,\s*d:\s*\d+(?:\.\d+)?/, `world: { w: ${room.w}, d: ${room.h}`);
    if (tuning && typeof tuning === 'object') {
      if (Number.isFinite(tuning.totalGameTimeS)) src = replaceConstNumber(src, 'TOTAL_GAME_TIME_S', tuning.totalGameTimeS);
      if (Number.isFinite(tuning.startPercent)) src = replaceConstNumber(src, 'START_PERCENT', tuning.startPercent);
      if (Number.isFinite(tuning.playerWalkSpeed)) src = replaceSectionNumber(src, 'player', 'walkSpeed', tuning.playerWalkSpeed);
      const npc = tuning.npc || {};
      for (const field of ['walkSpeed', 'idleMinSec', 'idleMaxSec', 'wanderChance', 'wanderRadius', 'arriveDist']) {
        if (Number.isFinite(npc[field])) src = replaceSectionNumber(src, 'npc', field, npc[field]);
      }
      const appMult = tuning.appMult || {};
      for (const field of ['MAP', 'RADAR', 'QUERY']) {
        if (Number.isFinite(appMult[field])) src = replaceSectionNumber(src, 'appMult', field, appMult[field]);
      }
    }
    if (src === before) return { changed: false, file: null };
    fs.writeFileSync(CONFIG_FILE, src);
    return { changed: true, file: CONFIG_FILE };
  } catch (err) {
    return { changed: false, error: String(err.message || err) };
  }
}

function ensureHistoryDir() {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

function backupCurrent() {
  if (!fs.existsSync(LAYOUT_FILE)) return null;
  ensureHistoryDir();
  const base = `layout-${ts()}`;
  let name = `${base}.json`;
  let n = 2;
  while (fs.existsSync(path.join(HISTORY_DIR, name))) {
    name = `${base}-${n}.json`;
    n++;
  }
  fs.copyFileSync(LAYOUT_FILE, path.join(HISTORY_DIR, name));
  pruneHistory();
  return name;
}

function pruneHistory() {
  let files;
  try { files = fs.readdirSync(HISTORY_DIR).filter(f => /^layout-\d{8}-\d{6}(-\d+)?\.json$/.test(f)).sort(); } catch { return; }
  while (files.length > MAX_HISTORY) {
    fs.unlinkSync(path.join(HISTORY_DIR, files.shift()));
  }
}

function historyList() {
  ensureHistoryDir();
  return fs.readdirSync(HISTORY_DIR)
    .filter(f => /^layout-\d{8}-\d{6}(-\d+)?\.json$/.test(f))
    .sort()
    .reverse()
    .map(f => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf8'));
        return {
          file: f,
          time: f.replace(/^layout-(\d{8})-(\d{6})\.json$/, '$1 $2'),
          room: j.room ? `${j.room.w}×${j.room.h}` : '?',
          count: Array.isArray(j.placements) ? j.placements.length : '?',
        };
      } catch {
        return { file: f, time: f.replace(/^layout-(\d{8})-(\d{6})\.json$/, '$1 $2'), room: '?', count: '?' };
      }
    });
}

function writeLayout(layout) {
  const backup = backupCurrent();
  fs.writeFileSync(LAYOUT_FILE, JSON.stringify(layout, null, 2));
  const config = syncConfig(layout.room, layout.tuning);
  return { backup, config };
}

function restoreLayout(file) {
  const base = path.basename(file);
  if (!/^layout-\d{8}-\d{6}(-\d+)?\.json$/.test(base)) return { error: '非法文件名' };
  const src = path.join(HISTORY_DIR, base);
  if (!fs.existsSync(src)) return { error: `历史文件不存在: ${base}` };
  const layout = JSON.parse(fs.readFileSync(src, 'utf8'));
  const backup = backupCurrent();
  fs.copyFileSync(src, LAYOUT_FILE);
  const config = syncConfig(layout.room, layout.tuning);
  return { backup, config };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 2_000_000) reject(new Error('body 过大')); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, {
        ok: true,
        target: TARGET,
        hasLayout: fs.existsSync(LAYOUT_FILE),
        configSync: true,
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/layout/history') {
      send(res, 200, { history: historyList() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/layout') {
      if (!fs.existsSync(LAYOUT_FILE)) { send(res, 404, { error: 'layout.json 不存在' }); return; }
      send(res, 200, JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8')));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/layout') {
      const layout = JSON.parse(await readBody(req));
      const err = validate(layout);
      if (err) { send(res, 400, { error: err }); return; }
      const r = writeLayout(layout);
      send(res, 200, { ok: true, backup: r.backup, config: r.config, historySize: historyList().length });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/layout/restore') {
      const body = JSON.parse(await readBody(req));
      const r = restoreLayout(body.file);
      if (r.error) { send(res, 400, r); return; }
      send(res, 200, { ok: true, file: body.file, backup: r.backup, config: r.config });
      return;
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 500, { error: String(err.message || err) });
  }
});

fs.mkdirSync(TARGET, { recursive: true });

// Match Vite's behavior when the default port is already occupied.
const MAX_TRIES = 20;
function tryListen(port, attempt) {
  const srv = server.listen(port, () => {
    console.log(`[layout-server] listening on http://localhost:${port}`);
    console.log(`[layout-server] target: ${TARGET}`);
    console.log(`[layout-server] config: ${CONFIG_FILE}`);
  });
  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_TRIES) {
      tryListen(port + 1, attempt + 1);
    } else {
      console.error(`[layout-server] port ${port} unavailable: ${err.message}`);
      process.exit(1);
    }
  });
}
tryListen(PORT, 0);
