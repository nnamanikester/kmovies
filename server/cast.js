/**
 * Decides which responses are castable videos, starts casts, and passes
 * control signals to the TV. Holds everything the web app displays.
 */
import { EventEmitter } from 'node:events';
import { AUTO_CAST_INPUT_WINDOW_MS, AUTO_CAST_MIN_BYTES, AUTO_CAST_MIN_SECONDS } from './config.js';
import { MEDIA_TYPE, classifyResponse, parseDash, parseHls, sniffManifest, totalBytes } from './media.js';
import { EpisodeNavigator, episodeAddress, episodeLabel, nextSeasonAddress } from './episodes.js';
import { FIND_IN_PAGE, downloadOnline, findSubtitleLinks, hasOnlineSearch, isSubtitleResponse, listFolder, parseSubtitles, readFolderFile, searchOnline } from './subtitles.js';

const PAUSE_INTERVAL_MS = 3000;
const SUBTITLE_ARRIVAL_WINDOW_MS = 30000;
/** How long each way of reaching another episode gets to produce a new video. */
const ADVANCE_ATTEMPT_MS = 20000;
/** After picking a season, how long to wait for the site to start it before pressing episode 1. */
const SEASON_AUTOSTART_MS = 3000;
const LOOK_DELAYS_MS = [2500, 8000, 20000];
const SEASON_LIST_SETTLE_MS = 800;
const RECOVERED_PAGE_SETTLE_MS = 6000;
/** Shorter than this is an advert or a preview, not the next episode. */
const MIN_EPISODE_SECONDS = 120;
const CONTROL_ACTIONS = ['play', 'pause', 'toggle', 'seekBy', 'seekTo'];

export const CAST_STATUS = Object.freeze({ WAITING_FOR_TV: 'waiting-for-tv', ACTIVE: 'active' });

export class CastManager extends EventEmitter {
  /** tabId -> what's been found in that tab. */
  tabs = new Map();
  /** What the TV was told to play: { id, tabId, title, url, mediaType, status } */
  cast = null;
  playback = null;
  notice = null;
  autoCast = true;
  tv = null;
  /** When each video was stopped: a site's player retrying won't cast it again, but you pressing play will. */
  stopped = new Map();
  lastInputAt = 0;
  nextId = 1;
  /** Subtitles belonging to what's casting, which outlast the page. */
  castSubtitles = [];
  nextSubtitleId = 1;

  /** Going to another episode: { tabId, fromKey, found, cancelled } */
  advancing = null;
  /** What the page offers from the current cast: sent to the TV. */
  episodes = null;
  lookTimers = [];

  constructor({ chrome, relay }) {
    super();
    this.chrome = chrome;
    this.relay = relay;
    this.navigator = new EpisodeNavigator(chrome);
    chrome.on('response', (response) => this.onResponse(response).catch((err) => console.error('[detect]', err.message)));
    chrome.on('body', ({ tabId, url, status, body, requestHeaders }) => {
      findSubtitleLinks(body).forEach((link) => this.addPageSubtitle(tabId, link, requestHeaders));
      const mediaType = sniffManifest(body);
      if (!mediaType) return;
      this.onResponse({ tabId, url, status, contentType: '', mediaType, responseHeaders: {}, requestHeaders }).catch((err) => console.error('[detect]', err.message));
    });
    chrome.on('page', ({ tabId }) => this.scanPageForSubtitles(tabId));
    chrome.on('navigated', ({ tabId }) => this.onNavigated(tabId));
    chrome.on('tabs', () => this.changed());
    chrome.on('tabClosed', ({ tabId }) => {
      this.tabs.delete(tabId);
      this.changed();
    });
    chrome.on('openedBehind', () => {
      this.notice = 'A new tab opened behind this one.';
      this.changed();
    });
    chrome.on('navigationFailed', ({ message }) => this.showNavigationFailure(message));
    this.pauseTimer = setInterval(() => {
      // While changing episode, the site's player has to run for its next video to load.
      if (this.cast && !this.advancing) {
        this.chrome.pauseVideos(this.cast.tabId);
        this.scanPageForSubtitles(this.cast.tabId);
      }
      if (this.chrome.activeTab && this.chrome.activeTab.id !== this.cast?.tabId) this.scanPageForSubtitles(this.chrome.activeTab.id);
    }, PAUSE_INTERVAL_MS);
  }

  tabState(tabId) {
    let state = this.tabs.get(tabId);
    if (!state) {
      state = { candidates: [], subtitles: [], seen: new Set(), variants: new Set(), generation: 0, manifestQueue: Promise.resolve() };
      this.tabs.set(tabId, state);
    }
    return state;
  }

  snapshot() {
    const tab = this.chrome.activeTab;
    const state = tab ? this.tabState(tab.id) : null;
    const dialog = tab?.dialog;
    return {
      type: 'state',
      tabs: this.chrome.tabSummaries(),
      activeTabId: tab?.id ?? null,
      dialog: dialog ? { type: dialog.type, message: dialog.message, defaultValue: dialog.defaultValue } : null,
      // Captured headers hold session cookies; they stay on the server.
      candidates: state ? state.candidates.map(({ headers, ...candidate }) => candidate) : [],
      cast: this.cast,
      playback: this.playback,
      tvConnected: Boolean(this.tv),
      autoCast: this.autoCast,
      notice: this.notice,
    };
  }

  changed() {
    this.emit('changed', this.snapshot());
  }

  noteInput() {
    this.lastInputAt = Date.now();
  }

  setAutoCast(enabled) {
    this.autoCast = Boolean(enabled);
    this.changed();
  }

  showNavigationFailure(message) {
    this.notice = `Couldn’t open that page: ${message}`;
    this.changed();
  }

  clearNotice() {
    if (this.notice) {
      this.notice = null;
      this.changed();
    }
  }

  onNavigated(tabId) {
    const state = this.tabState(tabId);
    state.generation += 1;
    state.candidates = [];
    state.subtitles = [];
    state.seen.clear();
    state.variants.clear();
    if (tabId === this.chrome.activeTab?.id) this.notice = null;
    this.changed();
  }

  /* ---------- detection ---------- */

  async scanPageForSubtitles(tabId) {
    const frames = await this.chrome.evaluateInFrames(tabId, FIND_IN_PAGE);
    frames.forEach(({ frameUrl, value }) => value.forEach((link) => {
      this.addPageSubtitle(tabId, link, { referer: frameUrl, 'user-agent': this.chrome.userAgent });
    }));
  }

  async onResponse({ tabId, url, status, contentType, mediaType: knownType, responseHeaders, requestHeaders }) {
    if (status >= 400 || !/^https?:/.test(url)) return;
    if (isSubtitleResponse(url, contentType)) {
      this.addPageSubtitle(tabId, { url, language: null, label: null }, requestHeaders);
      return;
    }
    const mediaType = knownType || classifyResponse(url, contentType);
    if (!mediaType) return;

    const found = { tabId, url, mediaType, responseHeaders, requestHeaders };
    const isManifest = mediaType === MEDIA_TYPE.HLS || mediaType === MEDIA_TYPE.DASH;
    if (!isManifest) {
      await this.addCandidate(found);
      return;
    }
    // One at a time, in arrival order: a master playlist must name its variants
    // before they're judged, or one could be cast in place of the whole video.
    const state = this.tabState(tabId);
    const { generation } = state;
    state.manifestQueue = state.manifestQueue
      .then(() => (generation === state.generation ? this.addCandidate(found) : undefined))
      .catch((err) => console.error('[detect]', err.message));
    await state.manifestQueue;
  }

  async addCandidate({ tabId, url, mediaType, responseHeaders, requestHeaders }) {
    const state = this.tabState(tabId);
    const key = url.split('?')[0];
    if (state.seen.has(key) || state.variants.has(key)) return;
    state.seen.add(key);

    const candidate = {
      id: String(this.nextId++),
      tabId,
      url,
      mediaType,
      headers: requestHeaders,
      title: (await this.chrome.title(tabId)) || new URL(url).hostname,
      duration: null,
      bytes: null,
      isLive: false,
      hasDrm: false,
    };

    if (mediaType === MEDIA_TYPE.FILE) candidate.bytes = totalBytes(responseHeaders);
    else {
      // Still list a video we couldn't read; you may be able to cast it by hand.
      await this.inspectManifest(candidate, state).catch((err) => console.error('[detect]', new URL(url).hostname, err.message));
    }

    state.candidates = [...state.candidates, candidate];
    this.changed();
    this.sendVersions();
    if (this.isNewEpisode(candidate)) {
      this.advancing.found(candidate);
      return;
    }
    if (this.shouldAutoCast(candidate)) this.startCast(candidate);
  }

  isNewEpisode(candidate) {
    const { advancing } = this;
    if (!advancing || candidate.tabId !== advancing.tabId || !isCastable(candidate)) return false;
    if (candidate.url.split('?')[0] === advancing.fromKey) return false;
    return candidate.isLive || candidate.duration >= MIN_EPISODE_SECONDS || candidate.bytes >= AUTO_CAST_MIN_BYTES;
  }

  /* ---------- episodes ---------- */

  /** Looks a few times after a cast starts: sites fill in their lists as they load. */
  lookForEpisodes() {
    this.lookTimers.forEach(clearTimeout);
    this.lookTimers = LOOK_DELAYS_MS.map((delay) => setTimeout(() => this.refreshEpisodes().catch(() => {}), delay));
  }

  async refreshEpisodes() {
    const { cast } = this;
    if (!cast || this.advancing || !this.isCastPageOpen()) {
      this.sendEpisodes();
      return;
    }
    const found = await this.navigator.look(cast.tabId, cast.episode);
    if (this.cast !== cast || this.advancing || !found) return;
    if (found.current.episode || found.current.season) cast.episode = found.current;
    // A next episode known before keeps standing if the list has merely gone for now.
    this.episodes = found;
    this.sendEpisodes();
  }

  sendEpisodes() {
    if (!this.tv || !this.cast) return;
    const { current, next, previous, episodes = [], seasons = [], seriesEnd = false } = this.episodes || {};
    const named = (item) => (item ? { label: episodeLabel(item) } : null);
    this.tv.send({
      type: 'episodes',
      castId: this.cast.id,
      current: current && (current.episode || current.season) ? { ...current, label: episodeLabel(current) } : null,
      next: named(next),
      previous: named(previous),
      episodes,
      seasons,
      seriesEnd,
    });
  }

  isCastPageOpen() {
    const tab = this.chrome.tabById(this.cast?.tabId);
    return Boolean(tab && tab.url === this.cast.pageUrl);
  }

  /** You may have gone elsewhere in the tab, or closed it. The page is reopened out of sight. */
  async recoverCastPage() {
    const { cast } = this;
    const tab = await this.chrome.openBackgroundTab(cast.pageUrl);
    cast.tabId = tab.id;
    await new Promise((resolve) => setTimeout(resolve, RECOVERED_PAGE_SETTLE_MS));
    // It opens on its default episode; return to where the cast had got to.
    if (cast.episode?.season) {
      const found = await this.navigator.read(tab.id);
      if (found && found.info.currentSeason !== cast.episode.season) {
        await this.navigator.goToSeason(tab.id, cast.episode.season);
        await new Promise((resolve) => setTimeout(resolve, SEASON_LIST_SETTLE_MS));
      }
    }
  }

  /** Runs `act` and waits for it to produce a new video. */
  attempt(act) {
    return new Promise((resolve) => {
      const { advancing } = this;
      const timer = setTimeout(() => {
        advancing.found = () => {};
        resolve(null);
      }, ADVANCE_ATTEMPT_MS);
      advancing.found = (candidate) => {
        clearTimeout(timer);
        advancing.found = () => {};
        resolve(candidate);
      };
      advancing.cancel = () => {
        clearTimeout(timer);
        resolve(null);
      };
      Promise.resolve(act()).then((performed) => {
        if (performed === false) {
          clearTimeout(timer);
          resolve(null);
        }
      }).catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  /** The ways of reaching a target, most reliable first. */
  async waysToReach(target, direction, memory) {
    const { tabId, pageUrl } = this.cast;
    const ways = [];
    const nav = this.navigator;
    const step = direction === 'previous' ? -1 : 1;

    if (target?.via === 'season' || target?.season !== memory?.season && target?.season) {
      ways.push(async () => {
        const picked = await nav.goToSeason(tabId, target.season, memory);
        if (!picked) return false;
        // Many sites start the season by themselves; if not, press its first episode.
        await new Promise((resolve) => setTimeout(resolve, SEASON_AUTOSTART_MS));
        if (!this.advancing) return false;
        if (target.episode) return nav.pressEpisode(tabId, target.episode, { season: target.season });
        // Going back into a season means its last episode.
        return direction === 'previous' ? nav.pressLastEpisode(tabId, { season: target.season }) : nav.pressFirstEpisode(tabId, { season: target.season });
      });
    } else if (target?.via === 'range') {
      ways.push(async () => {
        await nav.pressRange(tabId, target.episode, memory);
        await new Promise((resolve) => setTimeout(resolve, SEASON_LIST_SETTLE_MS));
        return nav.pressEpisode(tabId, target.episode, memory);
      });
    } else if (target?.via === 'list' || target?.via === 'jump') {
      ways.push(() => nav.pressEpisode(tabId, target.episode, memory));
    }
    // Asked for a particular episode: it either plays, or you're told. Never a different one.
    if (target?.exact) return ways;
    ways.push(() => nav.pressNamedButton(tabId, direction === 'previous' ? 'previous' : 'next', memory));

    const address = episodeAddress(pageUrl, step);
    if (address) ways.push(() => this.chrome.navigateTab(tabId, address.url));
    if (direction === 'next' && !target?.season) {
      const season = nextSeasonAddress(pageUrl);
      if (season) ways.push(() => this.chrome.navigateTab(tabId, season.url));
    }
    if (direction === 'next') ways.push(() => nav.finishVideo(tabId));
    return ways;
  }

  /**
   * Moves to another episode. Only a new video starting counts as success,
   * and if none does, the TV is told so rather than playing a wrong guess.
   * @param {'next'|'previous'|'jump'} direction
   * @param {{ season?: number, episode?: number, via?: string }} [requested] for 'jump'
   */
  async advance(direction, requested) {
    if (!this.cast || this.advancing) return;
    const { cast } = this;
    const fromKey = cast.sourceUrl.split('?')[0];
    const memory = cast.episode;
    const known = direction === 'previous' ? this.episodes?.previous : this.episodes?.next;
    const target = requested || known;
    const label = target ? episodeLabel(target) : 'next episode';

    this.advancing = { tabId: cast.tabId, fromKey, found: () => {}, cancel: () => {} };
    this.tv?.send({ type: 'advancing', castId: cast.id, label });

    if (!this.isCastPageOpen()) {
      await this.recoverCastPage().catch((err) => console.error('[episodes]', err.message));
      if (!this.advancing) return;
      this.advancing.tabId = cast.tabId;
    }

    // Videos seen before can come back, as when returning to an episode.
    const state = this.tabState(cast.tabId);
    state.seen.clear();
    state.variants.clear();
    state.candidates = [];

    const ways = await this.waysToReach(target, direction, memory);
    let candidate = null;
    for (const way of ways) {
      if (!this.advancing) return;
      candidate = await this.attempt(way);
      if (candidate) break;
    }
    if (!this.advancing) return;
    this.advancing = null;

    if (!candidate) {
      this.tv?.send({ type: 'advanceFailed', castId: cast.id, label });
      this.chrome.pauseVideos(cast.tabId);
      return;
    }
    const reached = target?.episode || target?.season ? { season: target.season ?? memory?.season, episode: target.episode ?? null } : null;
    this.startCast(candidate, { episode: reached });
  }

  cancelAdvance() {
    const { advancing } = this;
    if (!advancing) return;
    this.advancing = null;
    advancing.cancel();
    if (this.cast) this.chrome.pauseVideos(this.cast.tabId);
  }

  onTvEpisode({ action, season, episode }) {
    if (action === 'look') return this.refreshEpisodes();
    if (action === 'next') return this.advance('next');
    if (action === 'previous') return this.advance('previous');
    if (action === 'cancel') return this.cancelAdvance();
    if (action === 'jump') {
      const number = Number(episode) || null;
      const toSeason = Number(season) || this.cast?.episode?.season || null;
      const changesSeason = Boolean(toSeason && toSeason !== this.cast?.episode?.season);
      if (!number && !changesSeason) return undefined; // Already in that season.
      const target = { season: toSeason, episode: number, via: changesSeason ? 'season' : 'jump', exact: true };
      const direction = number && this.cast?.episode?.episode && number < this.cast.episode.episode && !changesSeason ? 'previous' : 'next';
      return this.advance(direction, target);
    }
    return undefined;
  }

  /** Still on the cast's page, or so soon after it started that a site's subtitles are still arriving. */
  belongsToCast(tabId) {
    if (this.cast?.tabId !== tabId) return false;
    return this.cast.pageGeneration === this.tabState(tabId).generation || Date.now() - this.cast.startedAt < SUBTITLE_ARRIVAL_WINDOW_MS;
  }

  addPageSubtitle(tabId, { url, language, label }, requestHeaders) {
    if (!/^https?:\/\//.test(url)) return;
    const key = url.split('?')[0];
    const lists = [this.tabState(tabId).subtitles, ...(this.belongsToCast(tabId) ? [this.castSubtitles] : [])];
    let changed = false;
    lists.forEach((list) => {
      const known = list.find((track) => track.key === key);
      if (known) {
        // A caption list names the language; the file request alone doesn't.
        if (label && known.unnamed) {
          Object.assign(known, { label, language, unnamed: false });
          changed = true;
        }
        return;
      }
      const id = `page-${this.nextSubtitleId++}`;
      // Only these travel with a link found in JSON: credentials belonged to that other request.
      const { referer, Referer, origin, Origin, 'user-agent': agent, 'User-Agent': Agent } = requestHeaders || {};
      const headers = {};
      if (referer || Referer) headers.referer = referer || Referer;
      if (origin || Origin) headers.origin = origin || Origin;
      if (agent || Agent) headers['user-agent'] = agent || Agent;
      list.push({ id, key, url, headers, source: 'page', language, label: label || language || `Subtitle ${list.length + 1}`, unnamed: !label });
      changed = true;
    });
    if (changed) this.sendSubtitles();
  }

  async inspectManifest(candidate, state) {
    const { text, finalUrl } = await this.relay.readText(candidate.url, candidate.headers);
    if (candidate.mediaType === MEDIA_TYPE.DASH) {
      Object.assign(candidate, parseDash(text));
      return;
    }
    const playlist = parseHls(text, finalUrl);
    candidate.hasDrm = playlist.hasDrm;
    candidate.isLive = playlist.isLive;
    candidate.duration = playlist.duration;
    playlist.variants.forEach((variant) => state.variants.add(variant.split('?')[0]));

    // A master playlist doesn't state a length; its first variant does.
    if (playlist.isMaster) {
      const first = await this.relay.readText(playlist.streams[0], candidate.headers);
      const variant = parseHls(first.text, first.finalUrl);
      candidate.hasDrm = candidate.hasDrm || variant.hasDrm;
      candidate.isLive = variant.isLive;
      candidate.duration = variant.duration;
    }
  }

  shouldAutoCast(candidate) {
    if (!this.autoCast || this.cast || !isCastable(candidate)) return false;
    if (candidate.tabId !== this.chrome.activeTab?.id) return false;
    if (this.lastInputAt <= (this.stopped.get(candidate.url.split('?')[0]) || 0)) return false;
    if (Date.now() - this.lastInputAt > AUTO_CAST_INPUT_WINDOW_MS) return false;
    return candidate.isLive || candidate.duration >= AUTO_CAST_MIN_SECONDS || candidate.bytes >= AUTO_CAST_MIN_BYTES;
  }

  /* ---------- casting ---------- */

  castCandidate(id) {
    const candidate = this.tabState(this.chrome.activeTab?.id).candidates.find((c) => c.id === id);
    if (!candidate) return;
    if (!isCastable(candidate)) {
      this.notice = 'This video is DRM-protected, so it can’t be cast.';
      this.changed();
      return;
    }
    this.startCast(candidate);
  }

  /** @param {{ startAt?: number }} [options] where to begin, when switching version mid-way */
  startCast(candidate, { startAt = 0, episode = null } = {}) {
    const state = this.tabState(candidate.tabId);
    const sourceId = this.relay.register(candidate.url, candidate.headers);
    this.cast = {
      id: candidate.id,
      tabId: candidate.tabId,
      pageUrl: this.chrome.tabById(candidate.tabId)?.url ?? '',
      episode,
      startAt,
      title: candidate.title,
      mediaType: candidate.mediaType,
      url: this.relay.urlFor(sourceId, candidate.url),
      sourceUrl: candidate.url,
      pageGeneration: state.generation,
      startedAt: Date.now(),
      status: this.tv ? CAST_STATUS.ACTIVE : CAST_STATUS.WAITING_FOR_TV,
    };
    this.playback = null;
    this.notice = null;
    // Switching version keeps the subtitles found for the video.
    if (!startAt) this.castSubtitles = [...state.subtitles];
    this.episodes = startAt ? this.episodes : null;
    this.sendLoad();
    this.chrome.pauseVideos(candidate.tabId);
    this.lookForEpisodes();
    this.changed();
  }

  sendLoad() {
    if (!this.cast || !this.tv) return;
    const { id, title, url, mediaType, startAt } = this.cast;
    this.tv.send({ type: 'load', castId: id, title, url, mediaType, startAt });
    this.sendSubtitles();
    this.sendVersions();
    this.sendEpisodes();
  }

  /** Other videos the page offers, like a different quality it serves as a separate file. */
  sendVersions() {
    if (!this.tv || !this.cast) return;
    const versions = this.tabState(this.cast.tabId).candidates.filter(isCastable).map((candidate) => ({
      id: candidate.id,
      label: describeVersion(candidate),
    }));
    this.tv.send({ type: 'versions', castId: this.cast.id, versions });
  }

  switchVersion({ id, position }) {
    if (!this.cast || id === this.cast.id) return;
    const candidate = this.tabState(this.cast.tabId).candidates.find((c) => c.id === id);
    if (candidate && isCastable(candidate)) this.startCast(candidate, { startAt: Number(position) || 0 });
  }

  /* ---------- subtitles, all asked for from the TV ---------- */

  sendSubtitles() {
    if (!this.tv || !this.cast) return;
    const page = this.castSubtitles.map(({ id, label, language, source }) => ({ id, label, language, source }));
    const folder = listFolder().map((name) => ({ id: `folder:${name}`, label: name, language: null, source: 'folder' }));
    this.tv.send({ type: 'subtitleTracks', castId: this.cast.id, tracks: [...page, ...folder], onlineSearch: hasOnlineSearch() });
  }

  async readSubtitleTrack(id) {
    if (id.startsWith('folder:')) return readFolderFile(id.slice('folder:'.length));
    if (id.startsWith('online:')) return downloadOnline(Number(id.slice('online:'.length)));
    const track = this.castSubtitles.find((candidate) => candidate.id === id);
    if (!track) throw new Error('That subtitle is no longer available');
    return (await this.relay.readText(track.url, track.headers)).text;
  }

  async onTvSubtitle({ action, id, query, language }) {
    const reply = (message) => this.tv?.send({ type: 'subtitleReply', action, ...message });
    try {
      if (action === 'refresh') this.sendSubtitles();
      if (action === 'load') {
        const cues = parseSubtitles(await this.readSubtitleTrack(String(id)));
        if (cues.length === 0) throw new Error('That file has no subtitles the TV can read');
        reply({ id, cues });
      }
      if (action === 'search') reply({ results: await searchOnline(String(query), String(language || 'en')) });
    } catch (err) {
      console.error('[subtitles]', err.message);
      reply({ id, error: err.message });
    }
  }

  control({ action, value }) {
    if (action === 'stop') return this.stopCast();
    if (!CONTROL_ACTIONS.includes(action) || !this.tv) return undefined;
    return this.tv.send({ type: 'control', action, value: Number(value) || 0 });
  }

  stopCast() {
    this.cancelAdvance();
    this.lookTimers.forEach(clearTimeout);
    this.episodes = null;
    if (this.cast) this.stopped.set(this.cast.sourceUrl.split('?')[0], Date.now());
    this.tv?.send({ type: 'stop' });
    this.cast = null;
    this.playback = null;
    this.changed();
  }

  /* ---------- the TV ---------- */

  /** @param {{ send: (message: object) => void }} tv */
  attachTv(tv) {
    this.tv = tv;
    if (this.cast) this.cast.status = CAST_STATUS.ACTIVE;
    this.changed();
  }

  detachTv(tv) {
    if (this.tv !== tv) return;
    this.tv = null;
    this.playback = null;
    this.changed();
  }

  /** The TV says hello with what it's playing, so a dropped connection doesn't restart the movie. */
  onTvHello({ castId, codecs }) {
    if (codecs) console.log('[tv] can play:', JSON.stringify(codecs));
    if (this.cast && this.cast.id !== castId) this.sendLoad();
    else if (!this.cast && castId) this.tv?.send({ type: 'stop' });
  }

  /** With another episode known, the TV shows what's next. Without one, the site may still move on. */
  async onTvEnded() {
    if (this.advancing || this.endHandledFor === this.cast.id) return;
    this.endHandledFor = this.cast.id;
    if (this.episodes?.next) return;
    if (this.episodes?.seriesEnd) return;
    if (this.episodes?.looksLikeSeries) {
      await this.advance('next');
      return;
    }
    this.stopCast();
  }

  onTvStatus({ castId, status, position, duration, paused, error }) {
    if (!this.cast || castId !== this.cast.id) return;
    if (status === 'stopped') {
      this.stopCast();
      return;
    }
    if (status === 'ended') {
      this.onTvEnded();
      return;
    }
    if (status === 'error') {
      this.notice = `The TV couldn’t play this video: ${error || 'unknown error'}`;
      this.tv?.send({ type: 'stop' });
      this.cast = null;
      this.playback = null;
      this.changed();
      return;
    }
    this.playback = { status, position, duration, paused };
    this.changed();
  }
}

function describeVersion({ mediaType, url, duration, bytes }) {
  const parts = [mediaType === MEDIA_TYPE.FILE ? 'File' : mediaType.toUpperCase()];
  if (bytes) parts.push(`${Math.round(bytes / (1024 * 1024))} MB`);
  if (duration) parts.push(`${Math.round(duration / 60)} min`);
  const resolution = /(\d{3,4})p?(?=[._/-])/.exec(new URL(url).pathname);
  if (resolution) parts.unshift(`${resolution[1]}p`);
  return parts.join(' · ');
}

function isCastable(candidate) {
  return !candidate.hasDrm;
}
