/**
 * KMovies server, run on your computer. Serves the web app, drives Chrome,
 * relays video to the TV and carries control signals between them.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import qrcode from 'qrcode-terminal';
import { WebSocketServer, WebSocket } from 'ws';
import { ChromeBrowser } from './browser.js';
import { CastManager } from './cast.js';
import { Library } from './library.js';
import { PORT, WEB_DIR, loadSecrets, serverOrigin } from './config.js';
import { normalizeAddress } from './media.js';
import { createRelay } from './relay.js';

const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
/** Skip screen frames for a viewer that can't keep up, rather than build up delay. */
const MAX_BUFFERED_BYTES = 1024 * 1024;

const { token, relaySecret } = loadSecrets();
const SELECTION_CHECK_MS = 120;
const library = new Library(() => broadcast(library.snapshot()));
const chrome = new ChromeBrowser(library);
const relay = createRelay({ secret: relaySecret, origin: serverOrigin });
const cast = new CastManager({ chrome, relay });
const senders = new Set();

function serveWebApp(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(WEB_DIR, relative);
  if (!file.startsWith(WEB_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  return fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname.startsWith('/relay/') || url.pathname.startsWith('/relay-dir/')) return relay.handle(req, res, url);
  return serveWebApp(res, url.pathname);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://local');
  const role = { '/ws/sender': 'sender', '/ws/receiver': 'receiver' }[url.pathname];
  if (!role || url.searchParams.get('t') !== token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  return wss.handleUpgrade(req, socket, head, (ws) => (role === 'sender' ? onSender(ws) : onReceiver(ws)));
});

/* ---------- web app ---------- */

function sendJson(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function broadcast(message) {
  senders.forEach((ws) => sendJson(ws, message));
}

let selectionTimer = null;

/** Copying happens in your own browser, so it needs to already know the page's selected text. */
function checkSelectionSoon() {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(async () => {
    broadcast({ type: 'selection', text: await chrome.selectedText().catch(() => '') });
  }, SELECTION_CHECK_MS);
}

function onSender(ws) {
  senders.add(ws);
  chrome.setViewers(senders.size);
  sendJson(ws, cast.snapshot());
  sendJson(ws, library.snapshot());
  sendJson(ws, { type: 'pageSize', ...chrome.pageSize() });
  if (chrome.activeTab?.lastFrame) ws.send(chrome.activeTab.lastFrame);

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    handleSenderMessage(message).catch((err) => {
      console.error('[sender]', message.type, err.message);
      if (message.type === 'navigate') cast.showNavigationFailure(err.message);
    });
  });
  ws.on('close', () => {
    senders.delete(ws);
    chrome.setViewers(senders.size);
  });
  ws.on('error', () => {});
}

async function handleSenderMessage(message) {
  switch (message.type) {
    case 'navigate': {
      const url = normalizeAddress(message.url);
      if (!url) throw new Error('That address isn’t a web page');
      cast.noteInput();
      return chrome.navigate(url);
    }
    case 'back':
      cast.noteInput();
      return chrome.goBack();
    case 'forward':
      cast.noteInput();
      return chrome.goForward();
    case 'reload':
      cast.noteInput();
      return chrome.reload();
    case 'newTab':
      return chrome.newTab(null);
    case 'closeTab':
      return chrome.closeTab(message.id);
    case 'activateTab':
      return chrome.activate(message.id);
    case 'toggleBookmark': {
      const tab = chrome.activeTab;
      return library.toggleBookmark(tab.url, tab.title);
    }
    case 'dialog':
      return chrome.answerDialog(chrome.activeTab?.id, message);
    case 'viewport':
      return chrome.setViewport(message);
    case 'pointer':
      if (message.phase === 'down') cast.noteInput();
      if (message.phase === 'up') checkSelectionSoon();
      return chrome.pointer(message);
    case 'wheel':
      return chrome.wheel(message);
    case 'key':
      if (message.phase === 'down') cast.noteInput();
      else checkSelectionSoon();
      return chrome.key(message);
    case 'text':
      cast.noteInput();
      return chrome.insertText(String(message.text));
    case 'cast':
      return cast.castCandidate(message.id);
    case 'control':
      return cast.control(message);
    case 'autoCast':
      return cast.setAutoCast(message.enabled);
    case 'dismissNotice':
      return cast.clearNotice();
    default:
      return undefined;
  }
}

cast.on('changed', (snapshot) => senders.forEach((ws) => sendJson(ws, snapshot)));
chrome.on('cursor', (cursor) => broadcast({ type: 'cursor', cursor }));
chrome.on('viewport', (size) => broadcast({ type: 'pageSize', ...size }));
chrome.on('frame', (frame) => {
  senders.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED_BYTES) ws.send(frame);
  });
});

/* ---------- TV ---------- */

function onReceiver(ws) {
  const tv = { send: (message) => sendJson(ws, message) };
  cast.attachTv(tv);
  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.type === 'hello') cast.onTvHello(message);
    if (message.type === 'status') cast.onTvStatus(message);
    if (message.type === 'subtitle') cast.onTvSubtitle(message);
    if (message.type === 'version') cast.switchVersion(message);
    if (message.type === 'episode') cast.onTvEpisode(message);
    if (message.type === 'startOver') cast.startOver();
    if (message.type === 'log') console.error('[tv]', String(message.text).slice(0, 500));
  });
  ws.on('close', () => cast.detachTv(tv));
  ws.on('error', () => {});
}

/* ---------- lifecycle ---------- */

async function main() {
  // The TV's video comes through this computer, so idle sleep would stop the movie.
  if (process.platform === 'darwin') spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }).on('error', () => {});
  await chrome.start();
  chrome.on('closed', () => {
    console.error('Chrome closed; stopping.');
    process.exit(1);
  });
  await new Promise((resolve) => server.listen(PORT, '0.0.0.0', () => {
    const link = `${serverOrigin()}/?t=${token}`;
    console.log(`\nKMovies is running.\nOpen this in your browser:\n\n  ${link}\n`);
    qrcode.generate(link, { small: true });
    resolve();
  }));
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  chrome.removeAllListeners('closed');
  cast.saveProgress();
  cast.progress.writeNow();
  await chrome.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export const ready = main().catch((err) => {
  console.error('Could not start:', err.message);
  process.exit(1);
});
