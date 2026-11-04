/**
 * Next episode, end to end, on very differently built test sites.
 * Usage: FFMPEG=/path/to/ffmpeg npm run test:e2e:episodes
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
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'kmovies-episodes-'));
const OUT = process.env.E2E_OUT;
const SERVER_PORT = 18780;
const SITE_PORT = 18781;
const env = { ...process.env, KMOVIES_HOST: '127.0.0.1', KMOVIES_PORT: String(SERVER_PORT), KMOVIES_STATE_DIR: path.join(WORK, 'state') };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const step = (name) => console.log(`  ok  ${name}`);

function makeVideos() {
  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  const dir = path.join(WORK, 'media');
  fs.mkdirSync(dir);
  const input = ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=180', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=180'];
  const encode = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '20', '-c:a', 'aac', '-b:a', '32k'];
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...input, ...encode, '-b:v', '2M', '-minrate', '2M', '-maxrate', '2M', '-bufsize', '1M', '-x264-params', 'nal-hrd=cbr:filler=1', '-movflags', '+faststart', path.join(dir, 'movie.mp4')]);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...input, ...encode, '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', path.join(dir, 'index.m3u8')]);
  return dir;
}

function startSite(dir) {
  const seen = { episodeRequests: [], brokenEpisode: null };
  const SHOW = { 1: 3, 2: 2 };
  const showPage = (kind) => `<!doctype html><title>Test Show${kind === 'own-autoplay' ? ' Season 1 Episode 1' : ''}</title><meta charset="utf-8">
<style>body{margin:0;font:16px sans-serif}.on{background:#103e25;color:#10a84d}button{cursor:pointer;height:40px;min-width:44px}#menu{position:absolute;background:#222}#menu button{display:block;width:100px}.episode-list{list-style:none;padding:0}.episode-list li{cursor:pointer;padding:4px}</style>
<h1>Test Show</h1><p>Plot and information about this series.</p><div id="video-slot"></div>
<div id="panel"><div id="seasons"></div><div id="list"></div></div>
<script>
const kind=${JSON.stringify(kind)};const show=${JSON.stringify(SHOW)};let season=1,episode=Number(new URLSearchParams(location.search).get('ep'))||1;
const stream=()=>'/ep/s'+season+'e'+episode+'/index.m3u8';
function play(){if(kind==='late-list'){episode=3;fetch(stream());fetch('/captions/s1e1.json');setTimeout(()=>fetch('/captions/s1e3.json'),3000);render();return}fetch(stream()).catch(()=>{});fetch('/captions/s'+season+'e'+episode+'.json').catch(()=>{});render();}
function pickSeason(s){season=s;episode=1;menu=false;if(kind!=='dropdown')play();else render();}
function pickEp(e){episode=e;play();}
let menu=false;
function render(){
  const seasons=document.getElementById('seasons');const list=document.getElementById('list');seasons.innerHTML='';list.innerHTML='';
  const all=[...Array(show[season]).keys()].map(i=>i+1);
  if(kind==='dropdown'){
    const toggle=document.createElement('button');toggle.innerHTML='<span>Season 0'+season+'</span>';toggle.onclick=()=>{menu=!menu;render()};seasons.append(toggle);
    if(menu){const m=document.createElement('div');m.id='menu';Object.keys(show).forEach(s=>{const b=document.createElement('button');b.textContent='Season 0'+s;if(Number(s)===season)b.className='on';b.onclick=()=>pickSeason(Number(s));m.append(b)});seasons.append(m)}
    const row=document.createElement('div');all.forEach(e=>{const b=document.createElement('button');if(e===episode){b.className='on';b.innerHTML='<img alt="playing" width="12" height="12" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">'}else b.innerHTML='<span>0'+e+'</span>';b.onclick=()=>pickEp(e);row.append(b)});list.append(row);
  }else if(kind==='classes'||kind==='newest-first'){
    const sel=document.createElement('select');Object.keys(show).forEach(s=>{const o=document.createElement('option');o.value=s;o.text='Season '+s;o.selected=Number(s)===season;sel.append(o)});sel.onchange=()=>pickSeason(Number(sel.value));seasons.append(sel);
    const ul=document.createElement('ul');ul.className='episode-list';(kind==='newest-first'?all.slice().reverse():all).forEach(e=>{const li=document.createElement('li');if(e===episode)li.className='active';const a=document.createElement('a');a.textContent='Episode '+e;a.href='#';a.onclick=(ev)=>{ev.preventDefault();pickEp(e)};li.append(a);ul.append(li)});list.append(ul);
  }else if(kind==='button'){
    const b=document.createElement('button');b.textContent='Next Episode';b.onclick=()=>pickEp(episode+1);list.append(b);
  }
}
if(kind==='decoy'){document.getElementById('list').innerHTML='<nav class="pagination"><a href="#">1</a><a href="#">2</a><a href="#">3</a><a href="#">Next</a></nav><div class="rating"><span>1</span><span>2</span><span>3</span></div>'}
else if(kind==='own-autoplay'){const v=document.createElement('video');v.muted=true;v.style.width='200px';const load=()=>{v.src='/ep/s'+season+'e'+episode+'/movie.mp4';v.play()};v.onended=()=>{episode+=1;load()};document.getElementById('video-slot').append(v);load()}
else{render();}
if(kind==='late-list'||kind==='address'||kind==='button'||kind==='dropdown'||kind==='classes'||kind==='newest-first'||kind==='decoy'||kind==='broken'){document.body.insertAdjacentHTML('afterbegin','<button id="start" style="position:fixed;inset:0;width:100%;height:100%;opacity:.01" onclick="this.remove();play()"></button>')}
if(kind==='decoy'){window.play=()=>fetch('/ep/movie/index.m3u8')}
if(kind==='broken'){window.kindBroken=true}
</script>`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const cors = { 'access-control-allow-origin': '*' };
    if (url.pathname.startsWith('/shows/')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(showPage(path.basename(url.pathname)));
    }
    // Each episode has its own subtitles, as on a real site.
    if (url.pathname.startsWith('/captions/')) {
      const which = path.basename(url.pathname, '.json');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ captions: [{ lan: 'en', lanName: 'English', url: `http://127.0.0.1:${SITE_PORT}/subs/${which}.vtt` }] }));
    }
    if (url.pathname.startsWith('/subs/')) {
      res.writeHead(200, { 'content-type': 'text/vtt' });
      return res.end(`WEBVTT\n\n00:00:00.000 --> 01:00:00.000\nFrom ${path.basename(url.pathname, '.vtt')}\n`);
    }
    if (url.pathname.startsWith('/ep/')) {
      const [, , which, name] = url.pathname.split('/');
      if (name === 'index.m3u8' || name === 'movie.mp4') seen.episodeRequests.push(which);
      if (which === seen.brokenEpisode) {
        res.writeHead(403, cors);
        return res.end('no');
      }
      const file = path.join(dir, path.basename(name));
      const types = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.mp4': 'video/mp4' };
      const size = fs.statSync(file).size;
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
    if (url.pathname === '/child.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><title>Child Page</title><h1>Page</h1>');
    }
    res.writeHead(404);
    return res.end();
  });
  return new Promise((resolve) => server.listen(SITE_PORT, '0.0.0.0', () => resolve({ server, seen })));
}

async function waitFor(what, check, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await check();
      if (last) return last;
    } catch (err) {
      last = err.message;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}

async function main() {
  const dir = makeVideos();
  const site = await startSite(dir);
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
  const launchArgs = { channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'] };
  const browser = await puppeteer.launch(launchArgs);
  const tvBrowser = await puppeteer.launch(launchArgs);
  try {
    const tv = await tvBrowser.newPage();
    const tvErrors = [];
    tv.on('pageerror', (err) => tvErrors.push(err.message));
    await tv.setViewport({ width: 1280, height: 720 });
    const token = new URL(link).searchParams.get('t');
    await tv.goto(`file://${path.join(ROOT, 'dist', 'index.html')}?server=${encodeURIComponent(`http://127.0.0.1:${SERVER_PORT}`)}&token=${token}`);
    await waitFor('the TV to connect', () => tv.evaluate(() => document.body.innerText.includes('Ready to cast')));

    const browse = await browser.newPage();
    await browse.setViewport({ width: 1280, height: 800 });
    await browse.goto(link);
    await browse.waitForSelector('.address input');
    await sleep(600);

    const tvVideo = (expression) => tv.evaluate(`(() => { const v = document.querySelector('video'); return v && (${expression}); })()`);
    const press = (key) => tv.keyboard.press(key);
    const shot = async (page, name) => {
      if (OUT) await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    };
    const panelText = () => tv.evaluate(() => document.querySelector('.subs').innerText);
    const clickItem = async (label) => {
      const clicked = await tv.evaluate((text) => {
        const item = [...document.querySelectorAll('.subs__item')].find((node) => node.textContent.includes(text));
        if (item) item.click();
        return Boolean(item);
      }, label);
      assert.ok(clicked, `panel should offer "${label}"`);
    };
    const stopOnTv = async () => {
      await tv.evaluate(() => document.activeElement.blur());
      if (await tv.$('.subs')) await press('Escape');
      if (await tv.$('.upnext')) {
        await tv.evaluate(() => [...document.querySelectorAll('.upnext button')].find((b) => /Stop|Close|Cancel/.test(b.textContent))?.click());
        await sleep(300);
      }
      if (!(await tv.$('video'))) return;
      await tv.evaluate(() => document.activeElement.blur());
      if (await tv.$('.bar__buttons')) await press('Escape');
      await press('Escape');
      await waitFor('Stop to be selected', () => tv.evaluate(() => document.activeElement.getAttribute('data-nav') === 'stop'));
      await press('Enter');
      await waitFor('the TV to stop', () => tv.evaluate(() => !document.querySelector('video')));
    };
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

    // --- Next episode, on very differently built sites ---
    const lastEpisode = () => site.seen.episodeRequests.at(-1);
    const startShow = async (kind, query = '') => {
      await goToPage(`http://127.0.0.1:${SITE_PORT}/shows/${kind}${query}`);
      await browse.mouse.click(...(await center()));
      await waitFor(`${kind} to play on the TV`, () => tvVideo('v.currentTime > 1'));
    };
    const stopShow = async () => {
      await tv.evaluate(() => document.activeElement.blur());
      if (await tv.$('video')) await stopOnTv();
      await sleep(400);
    };
    const nearEnd = (remaining) => tv.evaluate((left) => { const v = document.querySelector('video'); v.currentTime = v.duration - left; }, remaining);
    const barLabel = async () => {
      await tv.evaluate(() => document.activeElement.blur());
      await press('ArrowDown');
      await waitFor('controls', () => tv.$('.bar__buttons'));
      const label = await tv.evaluate(() => document.querySelector('.bar__episode')?.textContent ?? null);
      await press('Escape');
      return label;
    };
    const startFromBeginning = async () => {
      await waitFor('the restart icon', async () => {
        await tv.evaluate(() => document.activeElement.blur());
        await press('ArrowDown');
        await sleep(300);
        return tv.$('[data-nav="restart"]');
      }, 8000);
      await tv.evaluate(() => document.querySelector('[data-nav="restart"]').click());
    };
    const cardText = () => tv.evaluate(() => document.querySelector('.upnext')?.innerText ?? null);
    // Requested more than once: by the site, and then for the TV. "Loading" stays up until the TV has it.
    const requestedByTv = (which) => site.seen.episodeRequests.length >= 2 && site.seen.episodeRequests.slice(-2).every((request) => request === which);
    const waitForEpisode = (which) => waitFor(`${which} to play`, async () => requestedByTv(which) && !(await tv.$('.upnext--center')) && (await tvVideo('!v.ended && v.currentTime > 0.5')), 40000);

    await startShow('dropdown');
    await waitFor('the next episode to be known', async () => (await tv.evaluate(() => document.activeElement && true)) && (await barLabel()) === 'S1 E1', 15000);
    // Subtitles chosen on the first episode, which must follow to each episode's own.
    const caption = () => tv.evaluate(() => document.querySelector('.caption__text')?.textContent ?? null);
    const openSubtitles = async () => {
      await tv.evaluate(() => document.activeElement.blur());
      await press('ArrowDown');
      await waitFor('controls', () => tv.$('.bar__buttons'));
      await tv.evaluate(() => document.querySelector('[data-nav="subtitles"]').click());
      await waitFor('the subtitle panel', () => tv.$('.subs'));
    };
    const englishTracks = async () => (await panelText()).split('\n').filter((line) => line.trim() === 'English').length;
    await openSubtitles();
    await waitFor('English to be offered', async () => (await englishTracks()) === 1);
    await clickItem('English');
    await waitFor('episode 1’s subtitle', async () => (await caption()) === 'From s1e1');
    await press('Escape');
    await press('Escape');
    await nearEnd(24);
    await waitFor('the up next card', async () => /Next episode in \d+s/.test((await cardText()) || '') && /S1 E2/.test(await cardText()));
    await shot(tv, 'tv-up-next');
    await waitForEpisode('s1e2');
    step('Near the end, a countdown card appears, then the next episode plays by itself');
    await waitFor('episode 2’s own subtitle, chosen automatically', async () => (await caption()) === 'From s1e2', 15000);

    await waitFor('S1 E2 to be known', async () => (await barLabel()) === 'S1 E2', 15000);
    await nearEnd(24);
    await waitFor('the card', async () => /Play now/.test((await cardText()) || ''));
    assert.equal(await tv.evaluate(() => document.activeElement.textContent), 'Play now');
    await press('Enter');
    await waitForEpisode('s1e3');
    step('Play now on the card goes straight to the next episode');
    await waitFor('episode 3’s own subtitle, not episode 1’s', async () => (await caption()) === 'From s1e3', 15000);
    await openSubtitles();
    assert.equal(await englishTracks(), 1, 'only this episode’s subtitles are offered');
    await press('Escape');
    await press('Escape');
    step('Each episode shows its own subtitles, and old episodes’ are no longer offered');
    await stopShow();

    // The site loads its default episode's list, then the one you picked, after the TV has chosen.
    await startShow('late-list');
    await waitFor('the newer list to replace what’s showing', async () => (await caption()) === 'From s1e3', 20000);
    await openSubtitles();
    assert.equal(await englishTracks(), 1, 'only the newest list’s English is offered');
    await press('Escape');
    await press('Escape');
    step('A newer subtitle list replaces the older one, even after the TV has chosen');
    await stopShow();
    await startShow('dropdown', '?run=second');
    await waitFor('S1 E1 again', async () => (await barLabel()) === 'S1 E1', 15000);
    await startFromBeginning();
    await sleep(1000);
    await nearEnd(24);
    await waitForEpisode('s1e2');
    await waitFor('S1 E2 again', async () => (await barLabel()) === 'S1 E2', 15000);
    await startFromBeginning();
    await sleep(1000);
    await nearEnd(24);
    await waitForEpisode('s1e3');
    await waitFor('S1 E3 again', async () => (await barLabel()) === 'S1 E3', 15000);

    await waitFor('S1 E3 to be known', async () => (await barLabel()) === 'S1 E3', 15000);
    await waitFor('the next season to be known', async () => {
      await tv.evaluate(() => document.activeElement.blur());
      await press('ArrowDown');
      await waitFor('controls', () => tv.$('.bar__buttons'));
      const hasNext = await tv.$('[data-nav="next"]');
      await press('Escape');
      return Boolean(hasNext);
    }, 25000);
    await nearEnd(24);
    await waitFor('the next season on the card', async () => /S2 E1/.test((await cardText()) || ''));
    await press('ArrowRight');
    assert.equal(await tv.evaluate(() => document.activeElement.textContent), 'Cancel');
    await press('Escape');
    await waitFor('Back to cancel the card', async () => (await cardText()) === null);
    await tv.evaluate(() => { const v = document.querySelector('video'); v.currentTime = v.duration - 1; });
    await waitFor('the end card, with no autoplay after cancelling', async () => /Next: S2 E1/.test((await cardText()) || ''));
    await shot(tv, 'tv-end-card');
    assert.equal(lastEpisode(), 's1e3', 'cancelled, so nothing should start');
    await press('Enter');
    await waitForEpisode('s2e1');
    step('After a season’s last episode comes the next season, through a custom menu; cancelling means no autoplay');

    await waitFor('S2 E1 to be known', async () => (await barLabel()) === 'S2 E1', 15000);
    await tv.evaluate(() => document.activeElement.blur());
    await press('ArrowDown');
    await waitFor('controls', () => tv.$('.bar__buttons'));
    await tv.evaluate(() => document.querySelector('[data-nav="episodes"]').click());
    await waitFor('the episodes panel', async () => (await panelText()).includes('Now playing: S2 E1') && (await panelText()).includes('Episode 2'));
    await shot(tv, 'tv-episodes');
    await clickItem('Episode 2');
    await waitForEpisode('s2e2');
    await waitFor('S2 E2 to be known', async () => (await barLabel()) === 'S2 E2', 15000);
    await tv.evaluate(() => document.activeElement.blur());
    await press('ArrowDown');
    await waitFor('controls', () => tv.$('.bar__buttons'));
    await tv.evaluate(() => document.querySelector('[data-nav="episodes"]').click());
    await waitFor('previous in the panel', async () => (await panelText()).includes('Previous episode'));
    await clickItem('Previous episode');
    await waitForEpisode('s2e1');
    await waitFor('S2 E1 again', async () => (await barLabel()) === 'S2 E1', 15000);
    await tv.evaluate(() => document.activeElement.blur());
    await press('ArrowDown');
    await waitFor('controls', () => tv.$('.bar__buttons'));
    await tv.evaluate(() => document.querySelector('[data-nav="episodes"]').click());
    await waitFor('previous, into the last season', async () => (await panelText()).includes('Previous episode'));
    await clickItem('Previous episode');
    await waitForEpisode('s1e3');
    await waitFor('S1 E3, the last of the season before', async () => (await barLabel()) === 'S1 E3', 15000);
    await tv.evaluate(() => document.activeElement.blur());
    await press('ArrowDown');
    await waitFor('controls', () => tv.$('.bar__buttons'));
    await tv.evaluate(() => document.querySelector('[data-nav="episodes"]').click());
    await waitFor('the season list', async () => (await panelText()).includes('Season 1'));
    const beforeSame = lastEpisode();
    await clickItem('Season 1');
    await sleep(1500);
    assert.equal(lastEpisode(), beforeSame, 'picking the season you’re in does nothing');
    await clickItem('Season 2');
    await waitForEpisode('s2e1');
    step('The episodes panel moves to any episode or season, and back to the previous one');
    await stopShow();

    // The last episode of the series.
    await startShow('classes');
    await waitFor('the next episode', async () => (await barLabel()) === 'S1 E1', 15000);
    await tv.evaluate(() => document.activeElement.blur());
    await press('ArrowDown');
    await waitFor('controls', () => tv.$('.bar__buttons'));
    await tv.evaluate(() => document.querySelector('[data-nav="episodes"]').click());
    await waitFor('seasons', async () => (await panelText()).includes('Season 2'));
    await clickItem('Season 2');
    await waitForEpisode('s2e1');
    await waitFor('S2 E1 on a plain list and select menu', async () => (await barLabel()) === 'S2 E1', 15000);
    step('An ordinary list with an active class and a <select> menu works too');
    await nearEnd(24);
    await waitForEpisode('s2e2');
    await waitFor('S2 E2', async () => (await barLabel()) === 'S2 E2', 15000);
    await nearEnd(1);
    await waitFor('the end of the series', async () => /finished this series/.test((await cardText()) || ''), 20000);
    await shot(tv, 'tv-finished');
    await press('Enter');
    await waitFor('the TV to return to waiting', () => tv.evaluate(() => !document.querySelector('video')));
    step('After the last episode of the last season, the TV says the series is finished');

    // Other kinds of site.
    await startShow('newest-first');
    await waitFor('the list newest first', async () => (await barLabel()) === 'S1 E1', 15000);
    await nearEnd(24);
    await waitFor('the right next episode', async () => /S1 E2/.test((await cardText()) || ''));
    await waitForEpisode('s1e2');
    step('A list ordered newest first still goes to the correct next episode');
    await stopShow();

    await startShow('button');
    await waitFor('the Next button to be found', async () => {
      await tv.evaluate(() => document.activeElement.blur());
      await press('ArrowDown');
      await waitFor('controls', () => tv.$('.bar__buttons'));
      const hasNext = await tv.$('[data-nav="next"]');
      await press('Escape');
      return Boolean(hasNext);
    }, 25000);
    await nearEnd(24);
    await waitForEpisode('s1e2');
    step('A site with only a "Next Episode" button works');
    await stopShow();

    await startShow('own-autoplay');
    await nearEnd(0.5);
    await waitForEpisode('s1e2');
    step('A site whose own player moves on by itself is followed');
    await stopShow();

    // A movie with page numbers nearby must not be mistaken for a series.
    site.seen.episodeRequests.length = 0;
    await startShow('decoy');
    await sleep(3000);
    await nearEnd(24);
    await sleep(2000);
    assert.equal(await cardText(), null, 'page numbers are not episodes');
    await nearEnd(0.5);
    await waitFor('a movie’s end to return the TV to waiting', () => tv.evaluate(() => !document.querySelector('video')), 15000);
    assert.deepEqual([...new Set(site.seen.episodeRequests)], ['movie']);
    step('A movie with page numbers isn’t treated as a series, and just ends');

    // A next episode that never starts.
    site.seen.brokenEpisode = 's1e2';
    await startShow('dropdown');
    await waitFor('known', async () => (await barLabel()) === 'S1 E1', 15000);
    await nearEnd(24);
    await waitFor('the card', async () => /Play now/.test((await cardText()) || ''));
    await press('Enter');
    await waitFor('the failure message', async () => /didn’t start/.test((await cardText()) || ''), 70000);
    await shot(tv, 'tv-next-failed');
    step('When the next episode won’t start, the TV says so instead of guessing');
    site.seen.brokenEpisode = null;
    await press('Enter');
    await waitForEpisode('s1e2');
    step('Try again then plays it');
    await stopShow();

    // Are you still watching?
    await startShow('classes');
    await waitFor('known', async () => (await barLabel()) === 'S1 E1', 15000);
    await tv.evaluate(() => document.activeElement.blur());
    for (const expected of ['s1e2', 's1e3', 's2e1']) {
      await sleep(3000);
      await waitFor('next known', () => tv.evaluate(() => document.querySelector('video')?.duration > 0));
      await sleep(9000);
      await nearEnd(24);
      await waitForEpisode(expected);
    }
    await sleep(9000);
    await nearEnd(24);
    await waitFor('the question', async () => /still watching/.test((await cardText()) || ''), 15000);
    await shot(tv, 'tv-still-watching');
    await sleep(11000);
    assert.equal(lastEpisode(), 's2e1', 'nothing plays until you answer');
    await press('Enter');
    await waitForEpisode('s2e2');
    step('After three episodes untouched, it asks "Are you still watching?" and waits for you');
    await stopShow();

    // You browsed elsewhere in that tab while it played.
    await startShow('dropdown');
    await waitFor('known', async () => (await barLabel()) === 'S1 E1', 15000);
    await goToPage(`http://127.0.0.1:${SITE_PORT}/child.html`);
    await nearEnd(24);
    await waitForEpisode('s1e2');
    await waitFor('the browser left where you were', async () => browse.evaluate(() => /Child Page/.test(document.querySelector('.tab--active .tab__title').textContent)));
    step('Browsing elsewhere doesn’t stop it: the show’s page reopens out of sight');
    await stopShow();

    // --- Continuing where you left off ---
    const watch = async (query) => {
      await goToPage(`http://127.0.0.1:${SITE_PORT}/shows/classes${query}`);
      await browse.mouse.click(...(await center()));
      await waitFor('video to start on the TV', () => tvVideo('v.readyState >= 2 && v.currentTime > 0'), 30000);
    };
    const seekTo = (seconds) => tv.evaluate((to) => { document.querySelector('video').currentTime = to; }, seconds);
    const notice = () => tv.evaluate(() => document.querySelector('.resumed')?.innerText ?? null);
    const at = () => tvVideo('v.currentTime');
    const stopNow = async () => {
      if (await tv.$('video')) await stopOnTv();
      await sleep(300);
    };

    // Earlier checks watched these episodes, so begin clean.
    await watch('?run=first');
    await startFromBeginning();
    await waitFor('the beginning', async () => (await at()) < 10);
    await sleep(1500);
    assert.equal(await notice(), null);
    await seekTo(60);
    await waitFor('position 60', async () => (await at()) >= 60);
    await sleep(11000);
    await stopNow();
    await watch('?run=first');
    await waitFor('the notice', async () => /Continuing from 1:\d\d/.test((await notice()) || ''));
    assert.ok((await at()) >= 58, `should continue from about 1:00, was at ${await at()}`);
    await shot(tv, 'tv-resumed');
    step('A video continues from where it stopped, saved every 10 seconds');

    assert.equal(await tv.$('[data-nav="restart"]'), null, 'it only appears with the other buttons');
    assert.equal(await tv.$('.resumed button'), null, 'the message has no button');
    await press('ArrowDown');
    await waitFor('controls on Play, not on restarting', async () => (await tv.evaluate(() => document.activeElement.getAttribute('data-nav'))) === 'play');
    const tooltip = () => tv.evaluate(() => { const tip = document.querySelector('[data-nav="restart"] .bar__tooltip'); return tip && getComputedStyle(tip).display; });
    assert.equal(await tooltip(), 'none', 'the words only show when highlighted');
    const beforeArrow = await at();
    await press('ArrowLeft');
    await press('ArrowLeft');
    assert.equal(await tv.evaluate(() => document.activeElement.getAttribute('data-nav')), 'restart');
    assert.equal(await tooltip(), 'block');
    assert.ok((await at()) >= beforeArrow, 'highlighting it alone does nothing');
    await shot(tv, 'tv-restart-selected');
    await press('Enter');
    await waitFor('the very beginning', async () => (await at()) < 5);
    await stopNow();
    await watch('?run=first');
    assert.equal(await notice(), null);
    assert.ok((await at()) < 10, 'starting over forgets the old point');
    await waitFor('the icon on a video with nothing saved, after every hide', async () => {
      await tv.evaluate(() => document.activeElement.blur());
      await press('ArrowDown');
      await sleep(300);
      return tv.$('[data-nav="restart"]');
    }, 8000);
    await press('Escape');
    await waitFor('hidden', () => tv.evaluate(() => !document.querySelector('[data-nav="restart"]')));
    await press('ArrowDown');
    await waitFor('back again', () => tv.$('[data-nav="restart"]'));
    await press('Escape');
    step('Start from beginning works from the remote, forgets the old point, and is there on every video');

    // Each episode keeps its own point, and pausing saves straight away.
    await seekTo(50);
    await waitFor('position 50', async () => (await at()) >= 50);
    await tv.evaluate(() => document.activeElement.blur());
    await press('Enter');
    await waitFor('paused', () => tvVideo('v.paused'));
    await sleep(1500);
    await press('Enter');
    await waitFor('the EP button', async () => {
      await tv.evaluate(() => document.activeElement.blur());
      await press('ArrowDown');
      await sleep(300);
      return tv.$('[data-nav="episodes"]');
    }, 15000);
    await tv.evaluate(() => document.querySelector('[data-nav="episodes"]').click());
    await waitFor('the list', async () => (await panelText()).includes('Episode 2'));
    await clickItem('Episode 2');
    await waitForEpisode('s1e2');
    await startFromBeginning();
    await waitFor('episode 2 at its start', async () => (await at()) < 10);
    await sleep(1500);
    await seekTo(90);
    await waitFor('position 90', async () => (await at()) >= 90);
    await sleep(11000);
    await waitFor('the panel again', async () => {
      await tv.evaluate(() => document.activeElement.blur());
      await press('ArrowDown');
      await sleep(300);
      return tv.$('[data-nav="episodes"]');
    });
    await tv.evaluate(() => document.querySelector('[data-nav="episodes"]').click());
    await waitFor('the list', async () => (await panelText()).includes('Episode 1'));
    await clickItem('Episode 1');
    await waitForEpisode('s1e1');
    await waitFor('episode 1’s own point', async () => (await at()) >= 48 && (await at()) < 80, 15000);
    step('Each episode keeps its own point, and pausing saves straight away');

    // It survives restarting everything.
    const exited = new Promise((resolve) => serverProcess.once('exit', resolve));
    serverProcess.kill('SIGINT');
    await exited;
    startServer();
    await waitFor('the server to return', () => serverLog.filter((line) => line.includes('KMovies is running')).length === 2, 30000);
    await waitFor('the web app to reconnect', () => browse.$('.tv-status--on'), 20000);
    await sleep(2500);
    if (await tv.$('video')) await stopNow();
    await watch('?run=first');
    await waitFor('the point after a restart', async () => /Continuing from/.test((await notice()) || '') && (await at()) >= 48, 20000);
    step('Saved points survive restarting the server');

    // Watched to the end means it starts afresh.
    await seekTo(170);
    await waitFor('almost finished', async () => (await at()) >= 170);
    await sleep(1500);
    await stopNow();
    await watch('?run=first');
    assert.equal(await notice(), null);
    assert.ok((await at()) < 10, 'a finished video starts from the beginning');
    step('A video watched to the end starts from the beginning next time');
    await stopNow();

    assert.deepEqual(tvErrors, []);
    step('No script errors on the TV');
    console.log('\nAll next-episode checks passed.');
  } catch (err) {
    console.error(serverLog.filter((line) => /^\[/.test(line)).slice(-10).join(''));
    console.error('requests:', site.seen.episodeRequests.slice(-8).join(' '));
    console.error('tv:', await tv_text(tvBrowser));
    if (OUT) for (const [name, b] of [['tv', tvBrowser], ['browser', browser]]) { const pages = await b.pages(); await pages.at(-1).screenshot({ path: path.join(OUT, `failure-${name}.png`) }).catch(() => {}); }
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

async function tv_text(tvBrowser) {
  const pages = await tvBrowser.pages();
  return pages.at(-1).evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300)).catch(() => null);
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
