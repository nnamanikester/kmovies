/**
 * Runs the whole flow on this computer: the real server, web app and built TV
 * receiver, against a local "video site" that refuses requests without the
 * right Referer and cookie.
 *
 * Usage: FFMPEG=/path/to/ffmpeg npm run test:e2e
 * Set E2E_OUT to keep screenshots.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'kmovies-e2e-'));
const OUT = process.env.E2E_OUT;
const SERVER_PORT = 18770;
const SITE_PORT = 18771;
const env = {
  ...process.env,
  KMOVIES_HOST: '127.0.0.1',
  KMOVIES_PORT: String(SERVER_PORT),
  KMOVIES_STATE_DIR: path.join(WORK, 'state'),
  KMOVIES_SUBTITLES_DIR: path.join(WORK, 'subtitles'),
  KMOVIES_SUBTITLES_API: `http://127.0.0.1:${SITE_PORT}/os-api`,
  OPENSUBTITLES_API_KEY: 'test-key',
};
const VTT = (text) => `WEBVTT\n\n00:00:00.000 --> 01:00:00.000\n${text}\n`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeVideos() {
  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  const dir = path.join(WORK, 'media');
  fs.mkdirSync(dir);
  const input = ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=180', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=180'];
  const encode = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '20', '-c:a', 'aac', '-b:a', '32k'];
  // Constant bitrate: a movie-sized file, past the size that auto-casts (AUTO_CAST_MIN_BYTES).
  const movieSized = ['-b:v', '2M', '-minrate', '2M', '-maxrate', '2M', '-bufsize', '1M', '-x264-params', 'nal-hrd=cbr:filler=1'];
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...input, ...encode, ...movieSized, '-movflags', '+faststart', path.join(dir, 'movie.mp4')]);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...input, ...encode, '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', path.join(dir, 'index.m3u8')]);
  const dashDir = path.join(dir, 'dash');
  fs.mkdirSync(dashDir);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...input, '-map', '0:v', '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '40', '-c:a', 'aac', '-b:a', '32k', '-s:v:0', '320x180', '-b:v:0', '300k', '-s:v:1', '160x90', '-b:v:1', '100k', '-adaptation_sets', 'id=0,streams=v id=1,streams=a', '-f', 'dash', '-seg_duration', '4', '-use_template', '1', '-use_timeline', '1', path.join(dashDir, 'index.mpd')]);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...input, ...encode, '-s', '640x360', '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_filename', path.join(dir, 'hi%d.ts'), path.join(dir, 'index-hi.m3u8')]);
  fs.copyFileSync(path.join(dir, 'movie.mp4'), path.join(dir, 'movie2.mp4'));
  // Absolute, as the disguised playlist isn't served from the media directory.
  fs.writeFileSync(path.join(dir, 'master.m3u8'), [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Inside Stream",LANGUAGE="it",URI="/media/inside.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=320x180,SUBTITLES="subs"',
    '/media/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,SUBTITLES="subs"',
    '/media/index-hi.m3u8',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'inside.m3u8'), '#EXTM3U\n#EXT-X-TARGETDURATION:180\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:180,\ninside.vtt\n#EXT-X-ENDLIST\n');
  fs.writeFileSync(path.join(dir, 'inside.vtt'), 'WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n00:00:00.000 --> 00:03:00.000\nFrom inside the stream\n');
  fs.mkdirSync(env.KMOVIES_SUBTITLES_DIR);
  fs.writeFileSync(path.join(env.KMOVIES_SUBTITLES_DIR, 'my-movie.srt'), '1\n00:00:00,000 --> 01:00:00,000\nFrom my folder\n');
  fs.writeFileSync(path.join(dir, 'drm.m3u8'), '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://k",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:200,\nseg.ts\n#EXT-X-ENDLIST\n');
  return dir;
}

const PLAY_BUTTON = (onClick) => `<!doctype html><meta name=viewport content="width=device-width"><title>Test Movie</title>
<button id=p style="position:fixed;inset:0;width:100%;height:100%;font-size:40px" onclick="${onClick}">PLAY</button><div id=slot></div>`;

function startSite(dir) {
  const rejected = [];
  const seen = { typed: null, login: null, whoami: null, answered: null, clicks: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const cors = { 'access-control-allow-origin': '*' };
    if (url.pathname === '/mp4.html') {
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'session=secret123; HttpOnly; Path=/' });
      // Subtitles offered four ways: a <track> tag, settings in the HTML, a caption list, and a loaded file.
      return res.end(`${PLAY_BUTTON(`const v=document.createElement('video');v.src='/media/movie.mp4';v.muted=true;v.style.width='100px';slot.append(v);v.play();fetch('/captions.json');fetch('/subs/loaded.vtt')`)}
<video style="display:none"><track src="/subs/track.vtt" label="Track Tag" srclang="fr"><track kind="metadata" src="/subs/thumbs.vtt" label="Player Internal"></video>
<script>var playerConfig={"subtitle":"http:\\/\\/127.0.0.1:${SITE_PORT}\\/subs\\/inline.vtt"};</script>`);
    }
    if (url.pathname === '/captions.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ tracks: [{ file: `http://127.0.0.1:${SITE_PORT}/subs/list?id=7`, kind: 'captions', label: 'German', language: 'de' }] }));
    }
    if (url.pathname.startsWith('/subs/')) {
      res.writeHead(200, { 'content-type': url.pathname.endsWith('.vtt') ? 'text/vtt' : 'text/plain' });
      return res.end(VTT(`From ${path.basename(url.pathname)}`));
    }
    if (url.pathname === '/os-api/subtitles') {
      const ok = req.headers['api-key'] === 'test-key' && url.searchParams.get('query') === 'Test Movie';
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ attributes: { language: 'en', release: 'Online Release', files: [{ file_id: 42, file_name: 'x.srt' }] } }] }));
    }
    if (url.pathname === '/os-api/download') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ link: `http://127.0.0.1:${SITE_PORT}/subs/online.vtt` }));
    }
    // Two versions of a video on one page.
    if (url.pathname === '/versions.html') {
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'session=secret123; HttpOnly; Path=/' });
      return res.end(PLAY_BUTTON(`const v=document.createElement('video');v.src='/media/movie.mp4';v.muted=true;slot.append(v);v.play();fetch('/media/movie2.mp4',{headers:{range:'bytes=0-1000'}})`));
    }
    // A sign-in, as any site has one.
    if (url.pathname === '/signin.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><title>Sign in</title><form action="/login" style="position:fixed;inset:0;margin:0"><input name="user" autocomplete="off" style="width:100%;height:100%;font-size:40px" oninput="fetch('/typed?v='+encodeURIComponent(this.value))"></form>`);
    }
    if (url.pathname === '/typed') {
      seen.typed = url.searchParams.get('v');
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === '/login') {
      seen.login = url.searchParams.get('user');
      res.writeHead(302, {
        location: '/account.html',
        'set-cookie': ['session_only=s3ssion; HttpOnly; Path=/', 'remember_me=r3member; Max-Age=86400; Path=/'],
      });
      return res.end();
    }
    if (url.pathname === '/account.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><title>My Account</title><h1>Account</h1><script>
        if (!localStorage.getItem('prefs')) localStorage.setItem('prefs', 'dark-mode');
        fetch('/whoami?storage=' + localStorage.getItem('prefs'));
      </script>`);
    }
    if (url.pathname === '/whoami') {
      seen.whoami = { cookie: req.headers.cookie || '', storage: url.searchParams.get('storage') };
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === '/cursors.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      const row = 'position:absolute;left:0;width:100%;height:16%;margin:0;padding:0;font-size:30px;line-height:16vh';
      return res.end(`<!doctype html><title>Cursors</title><body style="margin:0">
        <p style="${row};top:0">Some plain text here for reading</p>
        <a href="/x" style="${row};top:17%;display:block">A link</a>
        <div style="${row};top:34%;cursor:grab">grab me</div>
        <input style="${row};top:51%">
        <button style="${row};top:68%">A button</button>
        <iframe src="http://localhost:${SITE_PORT}/cursor-frame.html" style="${row};top:84%;border:0"></iframe>`);
    }
    if (url.pathname === '/cursor-frame.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><body style="margin:0"><a href="/x" style="display:block;height:100vh;font-size:30px">Link in another site's frame</a>`);
    }
    if (url.pathname === '/clicked') {
      seen.clicks.push([Number(url.searchParams.get('x')), Number(url.searchParams.get('y'))]);
      return res.end('ok');
    }
    if (url.pathname === '/clicks.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><title>Clicks</title><style>@keyframes spin{to{transform:rotate(360deg)}}</style><body style="margin:0;height:200vh"><div style="position:fixed;width:200px;height:200px;background:red;animation:spin 1s linear infinite"></div><script>addEventListener('mousedown',(e)=>fetch('/clicked?x='+e.clientX+'&y='+e.clientY))</script>`);
    }
    if (url.pathname === '/moving.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><title>Moving</title><body style="margin:0"><div id="box" style="width:300px;height:300px;background:red"></div><script>let n=0;setInterval(()=>{box.style.marginLeft=(n++%200)+'px'},30)</script>`);
    }
    if (url.pathname === '/stripes.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      // Solid 1px blocks: any grey on arrival is blur, as they can't be smoothed on the way in.
      return res.end(`<!doctype html><title>Stripes</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#fff}i{float:left;width:1px;height:100vh}i:nth-child(odd){background:#000}</style>${'<i></i>'.repeat(1000)}`);
    }
    if (url.pathname === '/dialog.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(PLAY_BUTTON(`fetch('/answered?yes='+confirm('Are you sure?'))`));
    }
    if (url.pathname === '/answered') {
      seen.answered = url.searchParams.get('yes');
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === '/links.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><title>Links</title><a target="_blank" href="/child.html" style="display:block;height:50vh;font-size:40px">Open child</a><button style="display:block;width:100%;height:50vh;cursor:default" onclick="window.open('http://localhost:${SITE_PORT}/ad.html')">Ad</button>`);
    }
    if (url.pathname === '/child.html' || url.pathname === '/ad.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><title>${url.pathname === '/ad.html' ? 'Some Ad' : 'Child Page'}</title><h1>Page</h1>`);
    }
    // A playlist that reveals itself only by its contents.
    if (url.pathname === '/disguised.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(PLAY_BUTTON(`fetch('/feed?id=1')`));
    }
    if (url.pathname === '/feed') {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': fs.statSync(path.join(dir, 'master.m3u8')).size });
      return fs.createReadStream(path.join(dir, 'master.m3u8')).pipe(res);
    }
    if (url.pathname === '/hls.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(PLAY_BUTTON(`const f=document.createElement('iframe');f.src='http://localhost:${SITE_PORT}/player.html';slot.append(f)`));
    }
    // MovieBox's shape: cross-origin, so a preflight comes first, and a token header on every request.
    if (url.pathname === '/dash.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(PLAY_BUTTON(`fetch('http://localhost:${SITE_PORT}/dash/index.mpd',{headers:{'x-token':'t0ken'}})`));
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'access-control-allow-headers': 'x-token' });
      return res.end();
    }
    if (url.pathname.startsWith('/dash/')) {
      const file = path.join(dir, 'dash', path.basename(url.pathname));
      if (req.headers['x-token'] !== 't0ken' || !fs.existsSync(file)) {
        rejected.push(url.pathname);
        res.writeHead(403, cors);
        return res.end('forbidden');
      }
      res.writeHead(200, { ...cors, 'content-type': 'application/octet-stream', 'content-length': fs.statSync(file).size });
      return fs.createReadStream(file).pipe(res);
    }
    if (url.pathname === '/drm.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(PLAY_BUTTON(`fetch('/media/drm.m3u8')`));
    }
    if (url.pathname === '/player.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<script>new Worker('/worker.js')</script>`);
    }
    if (url.pathname === '/worker.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(`fetch('/media/master.m3u8');fetch('/media/index.m3u8');fetch('/media/inside.m3u8')`);
    }
    if (url.pathname.startsWith('/media/')) {
      const file = path.join(dir, path.basename(url.pathname));
      const referer = req.headers.referer || '';
      const cookieOk = !file.endsWith('.mp4') || (req.headers.cookie || '').includes('session=secret123');
      if (!referer.includes(String(SITE_PORT)) || !cookieOk) {
        rejected.push(url.pathname);
        res.writeHead(403, cors);
        return res.end('forbidden');
      }
      const size = fs.statSync(file).size;
      const types = { '.mp4': 'video/mp4', '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.vtt': 'text/vtt' };
      const headers = { ...cors, 'content-type': types[path.extname(file)], 'accept-ranges': 'bytes' };
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : size - 1;
        res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { ...headers, 'content-length': size });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(404);
    return res.end();
  });
  return new Promise((resolve) => server.listen(SITE_PORT, '0.0.0.0', () => resolve({ server, rejected, seen })));
}

async function waitFor(what, check, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await check();
      if (last && typeof last !== 'string') return last;
      if (typeof last === 'string' && !last.startsWith('showing ')) return last;
    } catch (err) {
      last = err.message;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}

const step = (name) => console.log(`  ok  ${name}`);

/** Back shows the controls with Stop selected; OK presses it. */
async function stopOnTv(tv, waitFor) {
  await tv.evaluate(() => document.activeElement.blur());
  if (await tv.$('.subs')) await tv.keyboard.press('Escape');
  if (await tv.$('.bar__buttons')) await tv.keyboard.press('Escape');
  await tv.keyboard.press('Escape');
  await waitFor('Stop to be selected', () => tv.evaluate(() => document.activeElement.getAttribute('data-nav') === 'stop'));
  await tv.keyboard.press('Enter');
  await waitFor('the TV to stop', () => tv.evaluate(() => !document.querySelector('video')));
}

async function main() {
  const dir = makeVideos();
  const site = await startSite(dir);
  console.log('Videos ready.');

  execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], { cwd: ROOT, env, stdio: 'inherit' });
  execFileSync('npx', ['vite', 'build', '--logLevel', 'error', '--config', 'vite.web.config.js'], { cwd: ROOT, env, stdio: 'inherit' });

  const serverLog = [];
  let serverProcess;
  const startServer = () => {
    serverProcess = spawn('node', ['server/index.js'], { cwd: ROOT, env });
    serverProcess.stdout.on('data', (d) => serverLog.push(String(d)));
    serverProcess.stderr.on('data', (d) => serverLog.push(String(d)));
  };
  startServer();
  const link = await waitFor('the server', () => /http:\/\/\S+\?t=\w+/.exec(serverLog.join(''))?.[0]);

  const browser = await puppeteer.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'] });
  // Its own browser, as on a real TV: a background tab may not play video.
  const tvBrowser = await puppeteer.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'] });
  try {
    const tv = await tvBrowser.newPage();
    const tvErrors = [];
    tv.on('pageerror', (err) => tvErrors.push(err.message));
    await tv.setViewport({ width: 1280, height: 720 });
    const token = new URL(link).searchParams.get('t');
    await tv.goto(`file://${path.join(ROOT, 'dist', 'index.html')}?server=${encodeURIComponent(`http://127.0.0.1:${SERVER_PORT}`)}&token=${token}`);
    await waitFor('the TV to connect', () => tv.evaluate(() => document.body.innerText.includes('Ready to cast')));
    step('TV is told the server address when opened, with nothing built in');

    const phone = await browser.newPage();
    await phone.setViewport({ width: 1280, height: 800 });
    const webAppMessages = [];
    const phoneNetwork = await phone.createCDPSession();
    await phoneNetwork.send('Network.enable');
    phoneNetwork.on('Network.webSocketFrameReceived', ({ response }) => {
      if (response.opcode === 1) webAppMessages.push(response.payloadData);
    });
    const open = async (target) => {
      if (!phone.url().startsWith('http')) {
        await phone.goto(link);
        await phone.waitForSelector('.address input');
        await sleep(600); // viewport message settles
      }
      await phone.click('.address input');
      await phone.keyboard.type(target);
      await phone.keyboard.press('Enter');
      await waitFor('the page to show', () => phone.evaluate(() => document.querySelector('.stage__screen')?.naturalWidth > 0));
      await sleep(1200);
    };
    const tapPage = async () => {
      const box = await (await phone.$('.stage')).boundingBox();
      await phone.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };
    const tvVideo = (expression) => tv.evaluate(`(() => { const v = document.querySelector('video'); return v && (${expression}); })()`);
    const press = (key) => tv.keyboard.press(key);
    const focused = () => tv.evaluate(() => document.activeElement.getAttribute('data-nav'));
    const caption = () => tv.evaluate(() => document.querySelector('.caption__text')?.textContent ?? null);
    const shot = async (page, name) => {
      if (OUT) await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    };
    const clickItem = async (label) => {
      const clicked = await tv.evaluate((text) => {
        const item = [...document.querySelectorAll('.subs__item')].find((node) => node.textContent.includes(text));
        if (item) item.click();
        return Boolean(item);
      }, label);
      assert.ok(clicked, `subtitle panel should offer "${label}"`);
    };
    const openSubtitles = async () => {
      if (await tv.$('.subs')) return;
      await tv.evaluate(() => document.activeElement.blur());
      await press('ArrowDown');
      await waitFor('controls', () => tv.$('.bar__buttons'));
      await tv.evaluate(() => document.querySelector('[data-nav="subtitles"]').click());
      await waitFor('the subtitle panel', () => tv.$('.subs'));
    };
    const panelText = () => tv.evaluate(() => document.querySelector('.subs').innerText);
    const openQuality = async () => {
      await tv.evaluate(() => document.activeElement.blur());
      await press('ArrowDown');
      await waitFor('controls', () => tv.$('.bar__buttons'));
      await tv.evaluate(() => document.querySelector('[data-nav="quality"]').click());
      await waitFor('the quality panel', async () => (await tv.$('.subs')) && (await panelText()).includes('Video quality'));
    };
    const closePanels = async () => {
      if (await tv.$('.subs')) await tv.keyboard.press('Escape');
      await tv.keyboard.press('Escape');
      await waitFor('controls to close', () => tv.evaluate(() => !document.querySelector('.bar__buttons')));
    };

    // --- MP4 that needs the page's Referer and HttpOnly cookie ---
    await open(`http://127.0.0.1:${SITE_PORT}/mp4.html`);
    await tapPage();
    await waitFor('the MP4 to play on the TV', () => tvVideo('v.currentTime > 1'));
    step('Playing an MP4 auto-casts it; TV plays through Referer + cookie protection');

    const direct = await fetch(`http://127.0.0.1:${SITE_PORT}/media/movie.mp4`);
    assert.equal(direct.status, 403);
    assert.equal(await phone.$('[aria-label="Pause"]'), null, 'playback controls belong to the TV');
    await waitFor('the web app to say where it is', () => phone.evaluate(() => document.querySelector('.now-casting')?.innerText.includes('TV remote')));
    assert.ok(!webAppMessages.some((m) => m.includes('secret123')), 'captured cookies must not reach the web app');
    const statusOf = (url) => fetch(url).then((r) => r.status);
    assert.equal(await statusOf(`http://127.0.0.1:${SERVER_PORT}/relay/nope?u=aHR0cDovL2V4YW1wbGUuY29t&s=bad`), 403);
    assert.equal(await statusOf(`http://127.0.0.1:${SERVER_PORT}/relay-dir/nope/bad/aHR0cDovL2V4YW1wbGUuY29tLw/x.m4s`), 403);
    step('The web app has no playback controls, and cookies and relay stay protected');

    // --- The remote, with controls hidden ---
    await waitFor('controls to hide', () => tv.evaluate(() => !document.querySelector('.bar')), 8000);
    await press('Enter');
    await waitFor('OK to pause', () => tvVideo('v.paused'));
    await press('Enter');
    await waitFor('OK to resume', () => tvVideo('!v.paused'));
    let before = await tvVideo('v.currentTime');
    await press('ArrowRight');
    await waitFor('Right to skip +10', () => tvVideo(`v.currentTime >= ${before + 9}`));
    assert.equal(await tv.$('.bar__buttons'), null, 'a skip shows the position only, so the next press skips again');
    const ahead = await tvVideo('v.currentTime');
    await press('ArrowLeft');
    await waitFor('Left to skip -10', () => tvVideo(`v.currentTime <= ${ahead - 5}`));
    step('Remote with controls hidden: OK pauses and plays, Left and Right skip 10 seconds');

    // --- The on-screen buttons ---
    await press('ArrowDown');
    await waitFor('controls with Play focused', async () => (await focused()) === 'play');
    await shot(tv, 'tv-controls');
    await press('Enter');
    await waitFor('the pause button', () => tvVideo('v.paused'));
    await press('Enter');
    await waitFor('the play button', () => tvVideo('!v.paused'));
    await press('ArrowRight');
    assert.equal(await focused(), 'forward10');
    before = await tvVideo('v.currentTime');
    await press('Enter');
    await waitFor('+10 button', () => tvVideo(`v.currentTime >= ${before + 9}`));
    await press('ArrowLeft');
    await press('ArrowLeft');
    assert.equal(await focused(), 'back10');
    before = await tvVideo('v.currentTime');
    await press('Enter');
    await waitFor('-10 button', () => tvVideo(`v.currentTime <= ${before - 5}`));
    step('On-screen buttons work with the remote: play, pause, back 10 and forward 10');

    await press('ArrowUp');
    assert.equal(await focused(), 'seek');
    before = await tvVideo('v.currentTime');
    await press('ArrowRight');
    await press('ArrowRight');
    await waitFor('the seek bar to jump about 60s', () => tvVideo(`v.currentTime >= ${before + 55} && v.currentTime <= ${before + 75}`));
    const track = await (await tv.$('.bar__track')).boundingBox();
    await tv.mouse.click(track.x + track.width * 0.25, track.y + track.height / 2);
    await waitFor('a pointer click on the seek bar', () => tvVideo('v.currentTime > 40 && v.currentTime < 60'));
    step('Seek bar works with the remote and the pointer');

    await tv.evaluate(() => document.querySelector('[data-nav="speed"]').click());
    await waitFor('speed 1.25x', () => tvVideo('v.playbackRate === 1.25'));
    await tv.evaluate(() => document.querySelector('[data-nav="speed"]').click());
    await waitFor('speed 1.5x', () => tvVideo('v.playbackRate === 1.5'));
    step('Playback speed');

    await tv.evaluate(() => document.querySelector('[data-nav="quality"]').click());
    await waitFor('the quality panel', async () => (await tv.$('.subs')) && (await panelText()).includes('only offers one quality'));
    step('Quality panel says when a site offers just one');
    await press('Escape');

    // --- Subtitles, from each kind of source ---
    await openSubtitles();
    await waitFor('every page source to be listed', async () => {
      const text = await panelText();
      return ['Track Tag', 'German', 'my-movie.srt'].every((name) => text.includes(name)) && (text.match(/Subtitle \d/g) || []).length >= 2;
    });
    await shot(tv, 'tv-subtitles');
    assert.ok(!(await panelText()).includes('Player Internal'), 'tracks that aren’t subtitles stay out of the list');
    step('Subtitle panel finds <track> tags, player settings, caption lists, loaded files and the folder');

    await clickItem('Track Tag');
    await waitFor('the <track> subtitle', async () => (await caption()) === 'From track.vtt');
    await clickItem('German');
    await waitFor('the caption list subtitle', async () => (await caption()) === 'From list');
    await clickItem('my-movie.srt');
    await waitFor('the folder subtitle', async () => (await caption()) === 'From my folder');
    step('Each source loads and shows on the TV');

    await clickItem('Search');
    await waitFor('online results', async () => (await panelText()).includes('Online Release'));
    await clickItem('Online Release');
    await waitFor('the online subtitle', async () => (await caption()) === 'From online.vtt');
    step('Online search: title filled in, results listed, subtitle downloaded and shown');

    await clickItem('Off');
    await waitFor('subtitles off', async () => (await caption()) === null);
    await clickItem('German');
    await waitFor('subtitles back on', async () => (await caption()) === 'From list');
    const raise = (name) => tv.evaluate((label) => document.querySelector(`[aria-label="${label}"]`).click(), name);
    await raise('Raise Delay');
    await waitFor('the delay value', async () => (await panelText()).includes('+0.5 s'));
    await raise('Raise Size');
    await waitFor('large subtitles', () => tv.$('.caption--large'));
    await clickItem('Background behind text');
    await waitFor('no background', () => tv.evaluate(() => !document.querySelector('.caption--boxed')));
    await shot(tv, 'tv-subtitle-settings');
    step('Subtitles: off, delay, size and background');

    await tv.evaluate(() => document.activeElement.blur());
    await press('Escape');
    await waitFor('Back to close the panel', async () => !(await tv.$('.subs')) && (await focused()) === 'subtitles');
    await press('Escape');
    await waitFor('Back to hide controls', () => tv.evaluate(() => !document.querySelector('.bar__buttons')));
    step('Back closes the panel, then hides the controls');

    await phone.close();
    const atClose = await tvVideo('v.currentTime');
    await sleep(3000);
    assert.ok((await tvVideo('v.currentTime')) > atClose + 1.5, 'video should keep playing with the web app closed');
    step('Closing the web app leaves the TV playing');

    await press('Escape');
    await waitFor('Stop focused by Back', async () => (await focused()) === 'stop');
    await press('Enter');
    await waitFor('Stop to end playback', () => tv.evaluate(() => !document.querySelector('video') && document.body.innerText.includes('Ready to cast')));
    step('Stop on the TV ends playback and returns to waiting');

    // --- HLS fetched by a worker inside a cross-site iframe ---
    const phone3 = await browser.newPage();
    await phone3.setViewport({ width: 1280, height: 800 });
    const goTo = async (target) => {
      await phone3.click('.address input');
      await phone3.keyboard.type(target);
      await phone3.keyboard.press('Enter');
      await sleep(1500);
      const stageBox = await (await phone3.$('.stage')).boundingBox();
      await phone3.mouse.click(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
    };
    await phone3.goto(link);
    await phone3.waitForSelector('.address input');
    await sleep(600);
    await goTo(`http://127.0.0.1:${SITE_PORT}/hls.html`);
    await waitFor('HLS to play on the TV', () => tvVideo('v.currentTime > 1'));
    await waitFor('HLS duration', () => tvVideo('v.duration > 170'));
    assert.equal(await phone3.evaluate(() => (document.querySelector('.streams summary')?.innerText.match(/\((\d+)\)/) || [])[1]), '1', 'a master playlist counts as one video');
    step('HLS from a worker in a cross-site iframe auto-casts and plays');

    // The language chosen last time was German, which this video doesn't offer.
    await openSubtitles();
    await waitFor('the track inside the stream', async () => (await panelText()).includes('Inside Stream'));
    await clickItem('Inside Stream');
    await waitFor('the subtitle from inside the stream', async () => (await caption()) === 'From inside the stream');
    step('Subtitle track inside the stream is listed and shown');
    await closePanels();

    await openQuality();
    await waitFor('both qualities', async () => {
      const text = await panelText();
      return text.includes('Auto') && text.includes('360p') && text.includes('180p');
    });
    await shot(tv, 'tv-quality');
    await clickItem('180p');
    await waitFor('the picture to switch to 180p', () => tvVideo('v.videoHeight === 180'));
    await clickItem('360p');
    await waitFor('the picture to switch to 360p', () => tvVideo('v.videoHeight === 360'));
    await clickItem('Auto');
    await closePanels();
    step('HLS: every quality the stream offers can be chosen on the TV');

    await stopOnTv(tv, waitFor);

    // --- A playlist with an unrevealing name ---
    await goTo(`http://127.0.0.1:${SITE_PORT}/disguised.html`);
    await waitFor('the disguised playlist to play on the TV', () => tvVideo('v.currentTime > 1'));
    step('A playlist with a disguised name is recognised by its contents and plays');
    await stopOnTv(tv, waitFor);

    // --- DASH behind a preflight and a token header ---
    await goTo(`http://127.0.0.1:${SITE_PORT}/dash.html`);
    await waitFor('DASH to play on the TV', () => tvVideo('v.currentTime > 1'));
    await waitFor('DASH duration', () => tvVideo('v.duration > 170'));
    await press('ArrowRight');
    const dashAt = await tvVideo('v.currentTime');
    await sleep(2500);
    assert.ok((await tvVideo('v.currentTime')) > dashAt, 'DASH should keep playing after a skip');
    await openQuality();
    await waitFor('both DASH qualities', async () => {
      const text = await panelText();
      return text.includes('180p') && text.includes('90p');
    });
    await clickItem('90p');
    await waitFor('the picture to switch to 90p', () => tvVideo('v.videoHeight === 90'), 40000);
    await clickItem('180p');
    await waitFor('the picture to switch to 180p', () => tvVideo('v.videoHeight === 180'), 40000);
    await closePanels();
    assert.equal((await fetch(`http://127.0.0.1:${SITE_PORT}/dash/index.mpd`)).status, 403);
    step('DASH behind a preflight and token header auto-casts, plays, skips and changes quality');
    await stopOnTv(tv, waitFor);

    // --- DRM is reported, never cast ---
    await goTo(`http://127.0.0.1:${SITE_PORT}/drm.html`);
    await waitFor('the DRM stream to be listed', () => phone3.$('.streams summary'));
    await phone3.click('.streams summary');
    await waitFor('the DRM label', () => phone3.evaluate(() => document.querySelector('.streams').innerText.includes('DRM-protected')));
    assert.equal(await tv.evaluate(() => Boolean(document.querySelector('video'))), false);
    step('DRM-protected stream is labelled and not cast');

    // --- Other versions of a video on the page ---
    await goTo(`http://127.0.0.1:${SITE_PORT}/versions.html`);
    await waitFor('the first version to play', () => tvVideo('v.currentTime > 2'));
    await tv.evaluate(() => { document.querySelector('video').currentTime = 60; });
    await waitFor('position 60', () => tvVideo('v.currentTime >= 60'));
    await openQuality();
    await waitFor('the versions', async () => (await panelText()).includes('Versions on this page'));
    const firstSource = await tvVideo('v.currentSrc');
    await tv.evaluate(() => {
      const item = [...document.querySelectorAll('.subs__item')].find((node) => node.textContent.includes('MB') && !node.classList.contains('subs__item--selected'));
      item.click();
    });
    await waitFor('the other version, from the same point', () => tvVideo(`v.currentSrc !== ${JSON.stringify(firstSource)} && v.currentTime >= 58`));
    step('Switching to another version on the page continues from the same point');
    await stopOnTv(tv, waitFor);

    // --- The keyboard goes straight to the website ---
    const browse = phone3;
    const center = async (fractionY = 0.5) => {
      const box = await (await browse.$('.stage')).boundingBox();
      return [box.x + box.width / 2, box.y + box.height * fractionY];
    };
    const goToPage = async (target) => {
      await browse.click('.address input');
      await browse.keyboard.type(target);
      await browse.keyboard.press('Enter');
      await sleep(1500);
    };
    assert.equal(await browse.$('.typebox'), null, 'there is no separate keyboard box');
    await goToPage(`http://127.0.0.1:${SITE_PORT}/signin.html`);
    await browse.mouse.click(...(await center()));
    await sleep(300);
    await browse.keyboard.type('Hello World');
    await waitFor('typed text with capitals and a space', () => site.seen.typed === 'Hello World');
    await browse.keyboard.press('Backspace');
    await browse.keyboard.press('Backspace');
    await waitFor('Backspace', () => site.seen.typed === 'Hello Wor');
    await browse.keyboard.press('ArrowLeft');
    await browse.keyboard.type('X');
    await waitFor('arrow keys moving the caret', () => site.seen.typed === 'Hello WoXr');
    await browse.keyboard.down('Meta');
    await browse.keyboard.press('ArrowLeft');
    await browse.keyboard.up('Meta');
    await browse.keyboard.type('>');
    await waitFor('Cmd+Left', () => site.seen.typed === '>Hello WoXr');
    await browse.keyboard.down('Meta');
    await browse.keyboard.press('KeyA');
    await browse.keyboard.up('Meta');
    await waitFor('the page selection to reach the web app', async () => {
      const copied = await browse.evaluate(() => {
        const event = new ClipboardEvent('copy', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
        document.querySelector('.stage').dispatchEvent(event);
        return event.clipboardData.getData('text/plain');
      });
      return copied === '>Hello WoXr';
    });
    await browse.keyboard.type('Z');
    await waitFor('Cmd+A then typing to replace everything', () => site.seen.typed === 'Z');
    await browse.keyboard.down('Meta');
    await browse.keyboard.press('KeyZ');
    await browse.keyboard.up('Meta');
    await waitFor('Cmd+Z to undo', () => site.seen.typed === '>Hello WoXr');
    await browse.keyboard.down('Meta');
    await browse.keyboard.press('KeyA');
    await browse.keyboard.up('Meta');
    await browse.evaluate(() => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', 'alice@example.com');
      document.querySelector('.stage').dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    });
    await waitFor('paste', () => site.seen.typed === 'alice@example.com');
    step('Your keyboard types straight into the site: capitals, caret keys, shortcuts, undo, copy and paste');

    // --- Signing in, then restarting everything ---
    await browse.keyboard.press('Enter');
    await waitFor('Enter to submit the form', () => site.seen.login === 'alice@example.com');
    await waitFor('the account page', () => site.seen.whoami?.storage === 'dark-mode');
    assert.ok(site.seen.whoami.cookie.includes('session_only=s3ssion') && site.seen.whoami.cookie.includes('remember_me=r3member'));
    step('Enter submits the site’s form, and the site signs you in');

    const exited = new Promise((resolve) => serverProcess.once('exit', resolve));
    serverProcess.kill('SIGINT');
    await exited;
    site.seen.whoami = null;
    assert.ok(await browse.evaluate(() => true));
    startServer();
    await waitFor('the page to come back by itself after restarting', () => site.seen.whoami, 45000);
    assert.equal(site.seen.whoami.storage, 'dark-mode', 'site storage survives');
    assert.ok(site.seen.whoami.cookie.includes('remember_me=r3member'), `saved cookie survives: ${site.seen.whoami.cookie}`);
    assert.ok(site.seen.whoami.cookie.includes('session_only=s3ssion'), `session-only cookie survives: ${site.seen.whoami.cookie}`);
    step('After restarting: the tab reopens, and the login, session cookie and site storage are all remembered');
    await waitFor('the TV to reconnect', () => browse.$('.tv-status--on'), 15000);
    await waitFor('the web app to reconnect', () => browse.evaluate(() => /My Account/.test(document.querySelector('.tab--active')?.innerText || '')), 15000);

    // --- Tabs, pop-ups and dialogs ---
    const tabTitles = () => browse.evaluate(() => [...document.querySelectorAll('.tab__title')].map((title) => title.textContent));
    const activeTitle = () => browse.evaluate(() => document.querySelector('.tab--active .tab__title').textContent);
    await goToPage(`http://127.0.0.1:${SITE_PORT}/links.html`);
    const [linkX, linkY] = await center(0.25);
    await browse.mouse.move(linkX, linkY);
    await waitFor('the pointer to match the link', () => browse.evaluate(() => document.querySelector('.stage').style.cursor === 'pointer'));
    await goToPage(`http://127.0.0.1:${SITE_PORT}/cursors.html`);
    const stageBox = await (await browse.$('.stage')).boundingBox();
    const cursorAt = async (top, expected, what) => {
      await browse.mouse.move(stageBox.x + 40, stageBox.y + stageBox.height * top);
      await browse.mouse.move(stageBox.x + 42, stageBox.y + stageBox.height * top);
      await waitFor(`the ${what} pointer (wanted ${expected})`, async () => {
        const actual = await browse.evaluate(() => document.querySelector('.stage').style.cursor);
        return actual === expected || `showing "${actual}"`;
      }, 5000).then((result) => assert.equal(result, true, `${what} pointer: ${result}`));
    };
    await cursorAt(0.07, 'text', 'text');
    await cursorAt(0.2, 'pointer', 'link');
    await cursorAt(0.42, 'grab', 'custom');
    await cursorAt(0.58, 'text', 'input');
    await cursorAt(0.75, 'default', 'button');
    await cursorAt(0.92, 'pointer', 'cross-site iframe link');
    // Sliding across the whole page without ever stopping still updates it.
    for (let i = 0; i <= 12; i += 1) await browse.mouse.move(stageBox.x + 40, stageBox.y + stageBox.height * (0.92 - i * 0.07));
    await waitFor('the text pointer after moving continuously', () => browse.evaluate(() => document.querySelector('.stage').style.cursor === 'text'), 3000);
    step('The mouse pointer matches the page: text, links, custom shapes, inputs, buttons and inside iframes');

    // --- Sharpness: every pixel exact, at the screen's real resolution ---
    await goToPage(`http://127.0.0.1:${SITE_PORT}/stripes.html`);
    const readPixels = (page) => page.evaluate(() => {
      const image = document.querySelector('.stage__screen');
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const row = context.getImageData(0, Math.floor(image.naturalHeight / 2), Math.min(400, image.naturalWidth), 1).data;
      const grays = [];
      for (let i = 0; i < row.length; i += 4) grays.push(row[i]);
      const stage = document.querySelector('.stage');
      return { natural: [image.naturalWidth, image.naturalHeight], wanted: [Math.round(stage.clientWidth * devicePixelRatio), Math.round(stage.clientHeight * devicePixelRatio)], blurred: grays.filter((gray) => gray > 2 && gray < 253).length, black: grays.filter((gray) => gray <= 2).length, white: grays.filter((gray) => gray >= 253).length };
    });
    let lastPixels;
    const checkSharp = (page, label) => waitFor(`${label} to be pixel exact`, async () => {
      const pixels = await readPixels(page);
      lastPixels = pixels;
      return pixels.natural[0] === pixels.wanted[0] && pixels.natural[1] === pixels.wanted[1] && pixels.blurred === 0 && pixels.black > 100 && pixels.white > 100;
    }, 8000).catch((err) => {
      throw new Error(`${err.message}: ${JSON.stringify(lastPixels)}`);
    });
    await checkSharp(browse, 'a normal screen');
    await browse.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
    await checkSharp(browse, 'a Retina screen');
    // While moving too, not only once still.
    await goToPage(`http://127.0.0.1:${SITE_PORT}/moving.html`);
    const movingFrames = await browse.createCDPSession();
    await movingFrames.send('Network.enable');
    let movingCount = 0;
    movingFrames.on('Network.webSocketFrameReceived', ({ response }) => {
      if (response.opcode === 2) movingCount += 1;
    });
    await sleep(2000);
    const moving = await readPixels(browse);
    assert.deepEqual(moving.natural, moving.wanted, 'a moving page should stay at full resolution');
    assert.ok(movingCount >= 16, `a moving page sent only ${movingCount} images in 2 seconds`);
    console.log(`        (moving page on Retina: ${movingCount / 2} images per second at ${moving.natural.join('x')})`);

    // Clicks land where they're aimed while the screen is being captured, at any size and density.
    const clicksLand = async (label, tab = browse) => {
      const box = await (await tab.$('.stage')).boundingBox();
      const size = await tab.evaluate(() => { const stage = document.querySelector('.stage'); return [stage.clientWidth, stage.clientHeight]; });
      assert.deepEqual([Math.round(box.width), Math.round(box.height)], size);
      for (let i = 0; i < 20; i += 1) {
        const [x, y] = [100 + ((i * 37) % 500), 80 + ((i * 23) % 300)];
        site.seen.clicks.length = 0;
        await tab.mouse.click(box.x + x, box.y + y);
        await waitFor(`the click ${i} on ${label}`, () => site.seen.clicks.length > 0, 3000);
        const [gotX, gotY] = site.seen.clicks[0];
        assert.ok(Math.abs(gotX - x) <= 1 && Math.abs(gotY - y) <= 1, `on ${label}, a click at ${x},${y} landed at ${gotX},${gotY}`);
      }
    };
    await goToPage(`http://127.0.0.1:${SITE_PORT}/clicks.html`);
    await sleep(500);
    await clicksLand('a busy page on a Retina screen');
    // Changing size while frames are being captured must not freeze the picture.
    for (const [width, height, deviceScaleFactor] of [[1100, 700, 2], [1512, 982, 1.5], [1280, 800, 2]]) {
      await browse.setViewport({ width, height, deviceScaleFactor });
      await waitFor(`the picture to follow the window at ${width}x${height}@${deviceScaleFactor}`, () => browse.evaluate(() => {
        const stage = document.querySelector('.stage');
        const image = document.querySelector('.stage__screen');
        return image.naturalWidth === Math.round(stage.clientWidth * devicePixelRatio) && image.naturalHeight === Math.round(stage.clientHeight * devicePixelRatio);
      }), 6000);
      await sleep(300);
      await clicksLand(`${width}x${height}@${deviceScaleFactor}`);
    }
    // The web app left open in a second tab of another size, and a window wider than Chrome goes.
    const otherTab = await browser.newPage();
    await otherTab.setViewport({ width: 900, height: 600, deviceScaleFactor: 2 });
    await otherTab.goto(browse.url());
    await sleep(1000);
    await browse.bringToFront();
    const stage2 = await (await browse.$('.stage')).boundingBox();
    site.seen.clicks.length = 0;
    await browse.mouse.click(stage2.x + stage2.width / 2, stage2.y + stage2.height / 2);
    await waitFor('a click from the other tab', () => site.seen.clicks.length > 0, 3000);
    const otherSize = await otherTab.evaluate(() => { const stage = document.querySelector('.stage'); return [stage.clientWidth, stage.clientHeight]; });
    assert.ok(Math.abs(site.seen.clicks[0][0] - otherSize[0] / 2) <= 1 && Math.abs(site.seen.clicks[0][1] - otherSize[1] / 2) <= 1, `the middle of the screen landed at ${site.seen.clicks[0]}, on a page of ${otherSize}`);
    await otherTab.close();
    await browse.setViewport({ width: 4200, height: 900, deviceScaleFactor: 1 });
    await sleep(800);
    const wide = await (await browse.$('.stage')).boundingBox();
    site.seen.clicks.length = 0;
    await browse.mouse.click(wide.x + wide.width / 2, wide.y + wide.height / 2);
    await waitFor('a click in a very wide window', () => site.seen.clicks.length > 0, 3000);
    assert.ok(Math.abs(site.seen.clicks[0][0] - 1920) <= 1, `the middle of a 4200-wide window landed at ${site.seen.clicks[0][0]} of 3840`);
    await browse.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
    await sleep(600);
    step('Clicks land where aimed on busy pages, at every size and density, and with the app open twice');

    await goToPage(`http://127.0.0.1:${SITE_PORT}/stripes.html`);
    await checkSharp(browse, 'still on a Retina screen');
    await browse.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await checkSharp(browse, 'back on a normal screen');

    // A still page must not keep re-sending images.
    await sleep(800);
    const framesReceived = await browse.createCDPSession();
    await framesReceived.send('Network.enable');
    let binaryFrames = 0;
    framesReceived.on('Network.webSocketFrameReceived', ({ response }) => {
      if (response.opcode === 2) binaryFrames += 1;
    });
    await sleep(2000);
    assert.ok(binaryFrames <= 1, `an unchanging page sent ${binaryFrames} images in 2 seconds`);
    step('Pages are sharp: every pixel exact at normal and Retina resolution, with no needless images');
    await goToPage(`http://127.0.0.1:${SITE_PORT}/links.html`);
    await browse.mouse.move(linkX, linkY);
    await browse.mouse.click(linkX, linkY);
    await waitFor('a link to open in a new tab, in front', async () => (await activeTitle()) === 'Child Page');
    assert.equal((await tabTitles()).length, 2);
    await browse.evaluate(() => [...document.querySelectorAll('.tab')].find((tab) => /Links/.test(tab.innerText)).querySelector('.tab__select').click());
    await waitFor('switching back', async () => (await activeTitle()) === 'Links');
    const [adX, adY] = await center(0.75);
    await browse.mouse.click(adX, adY);
    await waitFor('the pop-up to open as a tab', async () => (await tabTitles()).some((title) => title === 'Some Ad'));
    await sleep(700);
    assert.equal(await activeTitle(), 'Links', 'another site’s pop-up stays behind');
    await browse.evaluate(() => [...document.querySelectorAll('.tab')].find((tab) => /Some Ad/.test(tab.innerText)).querySelector('.tab__close').click());
    await waitFor('closing a tab', async () => !(await tabTitles()).includes('Some Ad'));
    step('Tabs: links open in front, another site’s pop-ups stay behind, and tabs switch and close');

    await goToPage(`http://127.0.0.1:${SITE_PORT}/dialog.html`);
    await browse.mouse.click(...(await center()));
    await waitFor('the site’s question', () => browse.evaluate(() => document.querySelector('.dialog__message')?.innerText === 'Are you sure?'));
    await shot(browse, 'browser-dialog');
    await browse.click('.dialog button[type="submit"]');
    await waitFor('the answer to reach the site', () => site.seen.answered === 'true');
    step('A site’s confirm box appears and gets your answer');

    await browse.click('.toolbar [aria-label="Bookmark this page"]');
    await waitFor('the bookmark', () => browse.$('.toolbar [aria-label="Remove bookmark"]'));
    await browse.click('[aria-label="New tab"]');
    await waitFor('the start page', () => browse.evaluate(() => [...document.querySelectorAll('.tile')].some((tile) => /Test Movie|My Account|Links|Child/.test(tile.innerText))));
    await waitFor('the address bar to be ready', () => browse.evaluate(() => document.activeElement === document.querySelector('.address input')));
    await shot(browse, 'browser-start');
    await browse.keyboard.type('child');
    await waitFor('a suggestion from history', () => browse.evaluate(() => /Child Page/.test(document.querySelector('.suggestions')?.innerText || '')));
    await shot(browse, 'browser-suggestions');
    await browse.keyboard.press('ArrowDown');
    await browse.keyboard.press('Enter');
    await waitFor('the suggestion to open', async () => (await activeTitle()) === 'Child Page');
    step('Start page, bookmarks, and address bar suggestions from history');
    await shot(browse, 'browser-page');

    assert.deepEqual(tvErrors, []);
    step('No script errors on the TV');
    console.log('\nAll end-to-end checks passed.');
  } catch (err) {
    console.error(serverLog.slice(-6).join('').replace(/[\u2580-\u2588 ]{10,}\n?/g, ''));
    console.error('site rejected:', site.rejected.slice(-8));
    for (const page of await tvBrowser.pages()) {
      const video = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v && { src: v.currentSrc.slice(0, 70), readyState: v.readyState, networkState: v.networkState, time: v.currentTime, paused: v.paused, error: v.error?.message };
      }).catch(() => null);
      if (video) console.error('tv video:', JSON.stringify(video));
    }
    for (const page of [...(await browser.pages()), ...(await tvBrowser.pages())]) {
      console.error('page:', page.url(), JSON.stringify(await page.evaluate(() => document.body?.innerText?.slice(0, 400)).catch(() => null)));
      if (OUT) await page.screenshot({ path: path.join(OUT, `failure-${Date.now()}.png`) }).catch(() => {});
    }
    throw err;
  } finally {
    await browser.close();
    await tvBrowser.close();
    serverProcess.kill('SIGTERM');
    site.server.close();
    site.server.closeAllConnections();
    await sleep(800);
    fs.rmSync(WORK, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
