/**
 * The Chrome that does the browsing, one tab per page. The web app shows the
 * active tab's screen and forwards the mouse and keyboard. Chrome reports every
 * response, including from cross-site iframes and workers, which is how playing
 * videos get picked up. Its profile on disk keeps logins, cookies and site data.
 */
import { EventEmitter } from 'node:events';
import puppeteer from 'puppeteer-core';
import { CHROME_PROFILE_DIR } from './config.js';
import { readSessionCookies, writeSessionCookies } from './library.js';

const SCREENCAST_QUALITY = 90;
const MAX_VIEWPORT = 3840;
/** Chrome can leave a capture unanswered, and the screen would stay frozen waiting for it. */
const CAPTURE_TIMEOUT_MS = 4000;
/** Once the page stops changing for this long, it's sent again without any compression blur. */
const SHARPEN_DELAY_MS = 150;
const INPUT_WORLD = 'kmovies-input';
const CURSOR_BINDING = 'kmoviesCursorChanged';
/**
 * Runs in every frame, in a world of its own that the site can't see or affect,
 * and reports the pointer shape the browser would really show.
 */
const WATCH_CURSOR = `(() => {
  let last = null;
  const editable = (el) => el.isContentEditable;
  const shapeAt = (event) => {
    const el = event.target;
    if (!el || el.nodeType !== 1) return 'default';
    const style = getComputedStyle(el);
    if (style.cursor !== 'auto') return style.cursor;
    if (editable(el)) return 'text';
    if (style.userSelect === 'none' || style.webkitUserSelect === 'none') return 'default';
    const range = document.caretRangeFromPoint && document.caretRangeFromPoint(event.clientX, event.clientY);
    const node = range && range.startContainer;
    if (!node || node.nodeType !== 3 || !node.textContent.trim()) return 'default';
    const bounds = document.createRange();
    bounds.selectNodeContents(node);
    const inside = Array.from(bounds.getClientRects()).some((r) => event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom);
    return inside ? 'text' : 'default';
  };
  addEventListener('mousemove', (event) => {
    const shape = shapeAt(event);
    if (shape === last) return;
    last = shape;
    globalThis.${CURSOR_BINDING}(shape);
  }, { capture: true, passive: true });
})()`;
const MAX_TRACKED_REQUESTS = 2000;
const FULL_HEADERS_WAIT_MS = 500;
const MAX_TEXT_BODY_BYTES = 2 * 1024 * 1024;
/** Unlabelled responses are usually video pieces, so only small ones are worth reading. */
const MAX_UNTYPED_BODY_BYTES = 256 * 1024;
const BINARY_TYPE = /^(video|audio|image|font)\//i;
const SESSION_SAVE_INTERVAL_MS = 15000;
const DIALOG_TIMEOUT_MS = 120000;
const POPUP_SETTLE_MS = 100;
const POPUP_ADDRESS_WAIT_MS = 3000;
const PAUSE_VIDEOS = `document.querySelectorAll('video,audio').forEach((m) => { m.muted = true; m.pause(); })`;
const READ_FAVICON = `(document.querySelector('link[rel~="icon"]') || {}).href || (location.origin + '/favicon.ico')`;
const READ_SELECTION = `(() => {
  const el = document.activeElement;
  if (el && typeof el.value === 'string' && el.selectionStart !== el.selectionEnd && el.type !== 'password') return el.value.slice(el.selectionStart, el.selectionEnd);
  return String(window.getSelection());
})()`;
const SESSION_COOKIE_FIELDS = ['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite', 'priority', 'sourceScheme', 'sourcePort', 'partitionKey'];

const MODIFIER = { ALT: 1, CTRL: 2, META: 4, SHIFT: 8 };
/** Chrome on a Mac leaves editing shortcuts to the app around it, so they're named here. */
const MAC_COMMANDS = {
  [`${MODIFIER.META}+KeyA`]: ['selectAll'],
  [`${MODIFIER.META}+KeyZ`]: ['undo'],
  [`${MODIFIER.META + MODIFIER.SHIFT}+KeyZ`]: ['redo'],
  [`${MODIFIER.META}+KeyX`]: ['cut'],
  [`${MODIFIER.META}+ArrowLeft`]: ['moveToBeginningOfLine'],
  [`${MODIFIER.META}+ArrowRight`]: ['moveToEndOfLine'],
  [`${MODIFIER.META}+ArrowUp`]: ['moveToBeginningOfDocument'],
  [`${MODIFIER.META}+ArrowDown`]: ['moveToEndOfDocument'],
  [`${MODIFIER.META + MODIFIER.SHIFT}+ArrowLeft`]: ['moveToBeginningOfLineAndModifySelection'],
  [`${MODIFIER.META + MODIFIER.SHIFT}+ArrowRight`]: ['moveToEndOfLineAndModifySelection'],
  [`${MODIFIER.ALT}+ArrowLeft`]: ['moveWordLeft'],
  [`${MODIFIER.ALT}+ArrowRight`]: ['moveWordRight'],
  [`${MODIFIER.ALT + MODIFIER.SHIFT}+ArrowLeft`]: ['moveWordLeftAndModifySelection'],
  [`${MODIFIER.ALT + MODIFIER.SHIFT}+ArrowRight`]: ['moveWordRightAndModifySelection'],
  [`${MODIFIER.ALT}+Backspace`]: ['deleteWordBackward'],
  [`${MODIFIER.META}+Backspace`]: ['deleteToBeginningOfLine'],
};

const sameSite = (a, b) => {
  try {
    const site = (url) => new URL(url).hostname.split('.').slice(-2).join('.');
    return site(a) === site(b);
  } catch {
    return false;
  }
};

export class ChromeBrowser extends EventEmitter {
  browser = null;
  /** Open tabs, in order. */
  tabs = [];
  activeTab = null;
  nextTabId = 1;
  ownPagesPending = 0;
  viewers = 0;
  screencasting = false;
  viewport = { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
  /** session:requestId -> what's known about a request awaiting its response. */
  requests = new Map();

  /** @param {import('./library.js').Library} library */
  constructor(library) {
    super();
    this.library = library;
  }

  async start() {
    this.browser = await puppeteer.launch({
      channel: 'chrome',
      headless: process.env.KMOVIES_SHOW_CHROME ? false : true,
      userDataDir: CHROME_PROFILE_DIR,
      defaultViewport: null,
      // Closing is ours to do: killed outright, Chrome loses recent cookies and site data.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--no-first-run'],
      // Pages show scrollbars as they normally would.
      ignoreDefaultArgs: ['--hide-scrollbars'],
    });
    this.userAgent = await this.browser.userAgent();
    this.browserClient = await this.browser.target().createCDPSession();
    await this.restoreSessionCookies();
    this.sessionTimer = setInterval(() => this.saveSessionCookies(), SESSION_SAVE_INTERVAL_MS);

    this.browser.on('targetcreated', (target) => this.onTargetCreated(target).catch(() => {}));
    this.browser.on('disconnected', () => this.emit('closed'));

    const [firstPage] = await this.browser.pages();
    const { tabs: urls, activeIndex } = this.library.data;
    const first = await this.addTab(firstPage, urls[0] || null);
    for (const url of urls.slice(1)) {
      this.ownPagesPending += 1;
      await this.addTab(await this.browser.newPage(), url);
    }
    const active = this.tabs[activeIndex] || first;
    await this.activate(active.id);
  }

  /* ---------- saving sessions ---------- */

  async restoreSessionCookies() {
    const cookies = readSessionCookies().map((cookie) => Object.fromEntries(
      SESSION_COOKIE_FIELDS.filter((field) => cookie[field] !== undefined).map((field) => [field, cookie[field]]),
    ));
    if (cookies.length) await this.browserClient.send('Storage.setCookies', { cookies }).catch((err) => console.error('[session]', err.message));
  }

  async saveSessionCookies() {
    const { cookies } = await this.browserClient.send('Storage.getCookies');
    writeSessionCookies(cookies.filter((cookie) => cookie.session));
  }

  saveTabs() {
    // Chrome closing closes every tab too, which isn't you closing them.
    if (this.closing) return;
    const urls = this.tabs.map((tab) => tab.pendingUrl || tab.url).map((url) => (/^https?:/.test(url) ? url : null));
    const kept = urls.filter(Boolean);
    this.library.setTabs(kept, Math.max(0, kept.indexOf(urls[this.tabs.indexOf(this.activeTab)])));
  }

  /* ---------- tabs ---------- */

  async onTargetCreated(target) {
    if (target.type() !== 'page') return;
    const opener = target.opener();
    if (!opener && this.ownPagesPending > 0) {
      this.ownPagesPending -= 1;
      return;
    }
    const page = await target.page();
    if (!page || this.tabs.some((tab) => tab.page === page)) return;
    const openedFrom = this.activeTab?.url;
    const tab = await this.addTab(page, null);
    this.emitTabs();
    // A link on the same site opens in front, as usual. Anything else stays behind, as ads do this.
    for (let waited = 0; waited < POPUP_ADDRESS_WAIT_MS && !/^https?:/.test(page.url()); waited += POPUP_SETTLE_MS) {
      await new Promise((resolve) => setTimeout(resolve, POPUP_SETTLE_MS));
    }
    if (!this.tabs.includes(tab)) return;
    // It may have loaded before this tab began listening.
    tab.url = page.url();
    this.library.addVisit(tab.url, '');
    this.saveTabs();
    this.updateTabDetails(tab);
    if (sameSite(tab.url, openedFrom)) await this.activate(tab.id);
    else this.emit('openedBehind', { title: tab.url });
  }

  /** @param {string|null} pendingUrl loaded when the tab is first shown */
  async addTab(page, pendingUrl) {
    const client = await page.createCDPSession();
    const tab = {
      id: this.nextTabId++, page, client, pendingUrl, lastFrame: null, dialog: null,
      url: page.url(), title: '', favicon: null, loading: false, canGoBack: false, canGoForward: false,
    };
    this.tabs.push(tab);

    await client.send('Page.enable');
    await client.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    await client.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
    await this.trackNetwork(client, tab);

    await this.watchCursor(client);
    client.on('Page.screencastFrame', (event) => this.onFrame(tab, event));
    client.on('Page.frameStartedLoading', ({ frameId }) => {
      if (frameId !== page.mainFrame()?._id) return;
      tab.loading = true;
      this.emitTabs();
    });
    client.on('Page.frameStoppedLoading', ({ frameId }) => {
      if (frameId !== page.mainFrame()?._id) return;
      tab.loading = false;
      this.updateTabDetails(tab);
    });
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      tab.url = frame.url();
      this.emit('navigated', { tabId: tab.id, url: tab.url });
      this.library.addVisit(tab.url, '');
      this.saveTabs();
      this.updateTabDetails(tab);
    });
    page.on('load', () => this.updateTabDetails(tab));
    page.on('dialog', (dialog) => this.onDialog(tab, dialog));
    page.on('close', () => this.onTabClosed(tab));
    return tab;
  }

  async updateTabDetails(tab) {
    const { page } = tab;
    try {
      tab.title = await page.title();
      if (!tab.dialog) tab.favicon = /^https?:/.test(page.url()) ? await page.evaluate(READ_FAVICON).catch(() => tab.favicon) : null;
      const { currentIndex, entries } = await tab.client.send('Page.getNavigationHistory');
      tab.canGoBack = currentIndex > 0 && entries[currentIndex - 1].url !== 'about:blank';
      tab.canGoForward = currentIndex < entries.length - 1;
    } catch {
      return; // The tab closed meanwhile.
    }
    this.library.setTitle(tab.url, tab.title);
    this.emit('page', { tabId: tab.id });
    this.emitTabs();
  }

  emitTabs() {
    this.emit('tabs');
  }

  tabSummaries() {
    return this.tabs.map(({ id, title, favicon, loading, canGoBack, canGoForward, url, pendingUrl }) => ({
      id, title, favicon, loading, canGoBack, canGoForward, url: pendingUrl || url,
    }));
  }

  tabById(id) {
    return this.tabs.find((tab) => tab.id === id);
  }

  async newTab(url) {
    this.ownPagesPending += 1;
    const tab = await this.addTab(await this.browser.newPage(), url || null);
    await this.activate(tab.id);
    return tab;
  }

  /** A tab for the cast's page, out of sight, so it doesn't disturb what you're browsing. */
  async openBackgroundTab(url) {
    this.ownPagesPending += 1;
    const tab = await this.addTab(await this.browser.newPage(), null);
    await this.applyViewport(tab).catch(() => {});
    if (this.activeTab) await this.activeTab.page.bringToFront().catch(() => {});
    await this.navigateTab(tab.id, url);
    this.saveTabs();
    this.emitTabs();
    return tab;
  }

  async navigateTab(tabId, url) {
    const tab = this.tabById(tabId);
    if (!tab) return false;
    tab.pendingUrl = null;
    await tab.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((err) => {
      // A newer navigation replaced this one, or a slow page simply hasn't finished.
      if (!/ERR_ABORTED|Navigation timeout/.test(err.message)) throw err;
    });
    return true;
  }

  async closeTab(id) {
    const tab = this.tabById(id);
    if (!tab) return;
    if (this.tabs.length === 1) await this.newTab(null);
    await tab.page.close({ runBeforeUnload: false }).catch(() => {});
  }

  onTabClosed(tab) {
    const index = this.tabs.indexOf(tab);
    if (index === -1) return;
    this.tabs.splice(index, 1);
    this.emit('tabClosed', { tabId: tab.id });
    if (this.activeTab === tab) {
      this.activeTab = null;
      const next = this.tabs[index] || this.tabs[index - 1];
      if (next) this.activate(next.id).catch(() => {});
    }
    this.saveTabs();
    this.emitTabs();
  }

  async activate(id) {
    const tab = this.tabById(id);
    if (!tab) return;
    const previous = this.activeTab;
    if (previous && previous !== tab && this.screencasting) await previous.client.send('Page.stopScreencast').catch(() => {});
    this.activeTab = tab;
    await this.applyViewport(tab).catch(() => {});
    await tab.page.bringToFront().catch(() => {});
    if (this.screencasting) await this.startScreencast();
    if (tab.lastFrame) this.emit('frame', tab.lastFrame);
    this.sharpenSoon(tab);
    this.emit('activated', { tabId: tab.id });
    this.saveTabs();
    this.emitTabs();
    if (tab.pendingUrl) {
      const url = tab.pendingUrl;
      tab.pendingUrl = null;
      this.navigate(url).catch((err) => this.emit('navigationFailed', { message: err.message }));
    }
  }

  /* ---------- dialogs from sites ---------- */

  onDialog(tab, dialog) {
    const timer = setTimeout(() => this.answerDialog(tab.id, { accept: false }), DIALOG_TIMEOUT_MS);
    tab.dialog = { handle: dialog, timer, type: dialog.type(), message: dialog.message(), defaultValue: dialog.defaultValue() };
    this.emitTabs();
  }

  answerDialog(tabId, { accept, text }) {
    const tab = this.tabById(tabId);
    if (!tab?.dialog) return;
    const { handle, timer } = tab.dialog;
    clearTimeout(timer);
    tab.dialog = null;
    (accept ? handle.accept(typeof text === 'string' ? text : undefined) : handle.dismiss()).catch(() => {});
    this.emitTabs();
  }

  /* ---------- network ---------- */

  async watchCursor(session) {
    session.on('Runtime.bindingCalled', ({ name, payload }) => {
      if (name === CURSOR_BINDING) this.emit('cursor', payload);
    });
    await session.send('Runtime.enable');
    await session.send('Runtime.addBinding', { name: CURSOR_BINDING, executionContextName: INPUT_WORLD });
    await session.send('Page.enable');
    await session.send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH_CURSOR, worldName: INPUT_WORLD, runImmediately: true });
  }

  /** Listens on a page, iframe or worker session, and on whatever it spawns. */
  async trackNetwork(session, tab) {
    session.on('Network.requestWillBeSent', ({ requestId, request }) => {
      const key = `${session.id()}:${requestId}`;
      const known = this.requests.get(key);
      if (known) Object.assign(known, { url: request.url, headers: { ...request.headers, ...known.headers } });
      else this.requests.set(key, { url: request.url, headers: request.headers, hasFullHeaders: false });
      if (this.requests.size > MAX_TRACKED_REQUESTS) this.requests.delete(this.requests.keys().next().value);
    });
    // The real headers sent, including cookies and Referer.
    session.on('Network.requestWillBeSentExtraInfo', ({ requestId, headers }) => {
      const key = `${session.id()}:${requestId}`;
      const known = this.requests.get(key);
      if (known) Object.assign(known, { headers: { ...known.headers, ...headers }, hasFullHeaders: true });
      else this.requests.set(key, { url: null, headers, hasFullHeaders: true });
      known?.onFullHeaders?.();
    });
    session.on('Network.responseReceived', ({ requestId, response, type }) => {
      // A CORS permission check for a request, not the content itself.
      if (type === 'Preflight') return;
      const request = this.requests.get(`${session.id()}:${requestId}`);
      const report = () => this.emit('response', {
        tabId: tab.id,
        url: response.url,
        status: response.status,
        resourceType: type,
        contentType: response.mimeType || '',
        responseHeaders: lowercaseKeys(response.headers),
        requestHeaders: { ...response.requestHeaders, ...request?.headers },
      });
      // Cookies and the real Referer can arrive after the response. Casting without them gets refused.
      if (request && !request.hasFullHeaders) {
        const timer = setTimeout(report, FULL_HEADERS_WAIT_MS);
        request.onFullHeaders = () => {
          clearTimeout(timer);
          report();
        };
      } else {
        report();
      }
      // Caption lists and disguised playlists show only in the body, available once it finishes.
      if (request && (type === 'Fetch' || type === 'XHR') && !BINARY_TYPE.test(response.mimeType)) {
        const isText = /json|text|xml|mpegurl/i.test(response.mimeType);
        Object.assign(request, {
          maxBodyBytes: isText ? MAX_TEXT_BODY_BYTES : MAX_UNTYPED_BODY_BYTES,
          responseUrl: response.url,
          responseStatus: response.status,
          sentHeaders: { ...response.requestHeaders, ...request.headers },
        });
      }
    });
    const forget = ({ requestId }) => this.requests.delete(`${session.id()}:${requestId}`);
    session.on('Network.loadingFinished', (event) => {
      const request = this.requests.get(`${session.id()}:${event.requestId}`);
      forget(event);
      if (!request?.maxBodyBytes || event.encodedDataLength > request.maxBodyBytes) return;
      session.send('Network.getResponseBody', { requestId: event.requestId })
        .then(({ body, base64Encoded }) => {
          if (base64Encoded) return;
          this.emit('body', { tabId: tab.id, url: request.responseUrl, status: request.responseStatus, body, requestHeaders: request.sentHeaders });
        })
        .catch(() => {});
    });
    session.on('Network.loadingFailed', forget);
    session.on('sessionattached', (child) => {
      this.trackNetwork(child, tab).catch(() => {});
      this.watchCursor(child).catch(() => {}); // Workers have no pointer, and refuse.
    });

    await session.send('Network.enable');
    await session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
  }

  /* ---------- screen ---------- */

  onFrame(tab, { data, sessionId }) {
    tab.client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    // Taking a sharp image makes Chrome send the same frame again. Nothing changed, so it's dropped.
    if (data === tab.lastStreamFrame) return;
    tab.lastStreamFrame = data;
    tab.frameCount = (tab.frameCount || 0) + 1;
    // The stream never goes above 1x, so on a high-density screen it only signals a change.
    if (this.viewport.deviceScaleFactor > 1) {
      if (tab === this.activeTab) this.captureChange(tab);
      return;
    }
    tab.lastFrame = Buffer.from(data, 'base64');
    if (tab !== this.activeTab) return;
    this.emit('frame', tab.lastFrame);
    this.sharpenSoon(tab);
  }

  /**
   * The visible page at full resolution. The clip matters: without one, a click that
   * arrives during the capture lands at its position divided by the pixel density.
   */
  screenshot(tab, options) {
    return inTurn(tab, async () => {
      const { cssVisualViewport: { pageX, pageY } } = await tab.client.send('Page.getLayoutMetrics');
      const { width, height } = this.viewport;
      return tab.client.send('Page.captureScreenshot', {
        ...options,
        fromSurface: true,
        captureBeyondViewport: false,
        clip: { x: pageX, y: pageY, width, height, scale: 1 },
      });
    });
  }

  /** Captures at full resolution, one at a time, always ending on the latest change. */
  async captureChange(tab) {
    tab.changePending = true;
    if (tab.capturingChange) return;
    tab.capturingChange = true;
    while (tab.changePending && tab === this.activeTab && !tab.dialog) {
      tab.changePending = false;
      const { data } = await this.screenshot(tab, { format: 'jpeg', quality: SCREENCAST_QUALITY }).catch(() => ({}));
      if (!data || tab !== this.activeTab) break;
      tab.lastFrame = Buffer.from(data, 'base64');
      this.emit('frame', tab.lastFrame);
    }
    tab.capturingChange = false;
    this.sharpenSoon(tab);
  }

  sharpenSoon(tab) {
    clearTimeout(tab.sharpenTimer);
    tab.sharpenTimer = setTimeout(() => this.sharpen(tab).catch(() => {}), SHARPEN_DELAY_MS);
  }

  /** JPEG frames keep scrolling smooth; a still page deserves every pixel exact. */
  async sharpen(tab) {
    if (tab !== this.activeTab || !this.screencasting || tab.dialog) return;
    const frameCount = tab.frameCount;
    const { data } = await this.screenshot(tab, { format: 'png' }).catch(() => ({}));
    // Something newer arrived meanwhile, and it will be sharpened in turn.
    if (!data || tab !== this.activeTab || tab.frameCount !== frameCount) return;
    tab.lastFrame = Buffer.from(data, 'base64');
    this.emit('frame', tab.lastFrame);
  }

  async startScreencast() {
    this.screencasting = true;
    await this.activeTab?.client.send('Page.startScreencast', {
      format: 'jpeg',
      quality: SCREENCAST_QUALITY,
      maxWidth: Math.round(this.viewport.width * this.viewport.deviceScaleFactor),
      maxHeight: Math.round(this.viewport.height * this.viewport.deviceScaleFactor),
    });
  }

  async stopScreencast() {
    this.screencasting = false;
    await this.activeTab?.client.send('Page.stopScreencast').catch(() => {});
  }

  /** Only encode the screen while someone is looking at it. */
  setViewers(count) {
    this.viewers = count;
    if (count > 0 && !this.screencasting) this.startScreencast().catch(() => {});
    if (count === 0 && this.screencasting) this.stopScreencast();
  }

  /**
   * Set on the same connection as the screen stream. Chrome keeps these per
   * connection, and the stream would otherwise stay at 1x, blurred on a Retina screen.
   */
  applyViewport(tab) {
    return inTurn(tab, async () => {
      const { width, height, deviceScaleFactor, isMobile, hasTouch } = this.viewport;
      await tab.client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: isMobile });
      await tab.client.send('Emulation.setTouchEmulationEnabled', { enabled: hasTouch });
    });
  }

  pageSize() {
    return { width: this.viewport.width, height: this.viewport.height };
  }

  async setViewport({ width, height, deviceScaleFactor, mobile }) {
    this.viewport = {
      width: clamp(width, 240, MAX_VIEWPORT),
      height: clamp(height, 240, MAX_VIEWPORT),
      deviceScaleFactor: clamp(deviceScaleFactor, 1, 3),
      isMobile: Boolean(mobile),
      hasTouch: Boolean(mobile),
    };
    this.emit('viewport', this.pageSize());
    const tab = this.activeTab;
    if (!tab) return;
    await this.applyViewport(tab);
    if (this.screencasting) {
      await tab.client.send('Page.stopScreencast').catch(() => {});
      await this.startScreencast();
      // A still page sends no new frame by itself, and would stay at its old resolution.
      this.sharpenSoon(tab);
    }
  }

  /* ---------- navigation ---------- */

  navigate(url) {
    return this.navigateTab(this.activeTab.id, url);
  }

  async goBack() {
    await this.activeTab.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }

  async goForward() {
    await this.activeTab.page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }

  async reload() {
    await this.activeTab.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }

  title(tabId) {
    const tab = this.tabById(tabId);
    return tab ? tab.page.title().catch(() => '') : Promise.resolve('');
  }

  /** Stops the copy playing in Chrome while the TV plays it, in every frame. */
  async pauseVideos(tabId) {
    const tab = this.tabById(tabId);
    if (!tab || tab.dialog) return;
    await Promise.all(tab.page.frames().map((frame) => frame.evaluate(PAUSE_VIDEOS).catch(() => {})));
  }

  /** What every frame of a tab reports for `expression`, with the frame's address. */
  async evaluateInFrames(tabId, expression) {
    const tab = this.tabById(tabId);
    if (!tab || tab.dialog) return [];
    const results = await Promise.all(tab.page.frames().map((frame) => frame.evaluate(expression)
      .then((value) => ({ frameUrl: frame.url(), value }))
      .catch(() => null)));
    return results.filter(Boolean);
  }

  /* ---------- input ---------- */

  async pointer({ kind, phase, x, y, button = 'left', clickCount = 1, modifiers = 0 }) {
    const { client } = this.activeTab;
    if (kind === 'touch') {
      const type = { down: 'touchStart', move: 'touchMove', up: 'touchEnd', cancel: 'touchCancel' }[phase];
      const touchPoints = phase === 'up' || phase === 'cancel' ? [] : [{ x, y }];
      return client.send('Input.dispatchTouchEvent', { type, touchPoints });
    }
    const type = { down: 'mousePressed', move: 'mouseMoved', up: 'mouseReleased' }[phase];
    if (!type) return undefined;
    const pressed = phase !== 'move';
    return client.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      modifiers,
      button: pressed || button !== 'none' ? button : 'none',
      buttons: phase === 'move' && button === 'left' ? 1 : phase === 'down' ? { left: 1, right: 2, middle: 4 }[button] : 0,
      clickCount: pressed ? clickCount : 0,
    });
  }

  wheel({ x, y, deltaX, deltaY, modifiers = 0 }) {
    return this.activeTab.client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers });
  }

  /** A key on your keyboard, pressed in the page exactly as if at this Chrome. */
  key({ phase, key, code, keyCode, text, modifiers = 0, location = 0, repeat = false }) {
    const isMac = process.platform === 'darwin';
    const held = !isMac && modifiers & MODIFIER.META ? (modifiers & ~MODIFIER.META) | MODIFIER.CTRL : modifiers;
    const commands = phase === 'down' && isMac ? MAC_COMMANDS[`${modifiers}+${code}`] || MAC_COMMANDS[`${modifiers}+${key}`] : undefined;
    return this.activeTab.client.send('Input.dispatchKeyEvent', {
      type: phase === 'up' ? 'keyUp' : text ? 'keyDown' : 'rawKeyDown',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      modifiers: held,
      text,
      unmodifiedText: text,
      location,
      autoRepeat: repeat,
      isKeypad: location === 3,
      commands,
    });
  }

  insertText(text) {
    return this.activeTab.client.send('Input.insertText', { text });
  }

  async selectedText() {
    const frames = await this.evaluateInFrames(this.activeTab?.id, READ_SELECTION);
    return frames.map((frame) => frame.value).find(Boolean) || '';
  }

  /** Saves everything, then lets Chrome finish writing its own cookies and site data. */
  async close() {
    this.closing = true;
    clearInterval(this.sessionTimer);
    await this.saveSessionCookies().catch(() => {});
    this.library.saveNow();
    await this.browser?.close().catch(() => {});
  }
}

/**
 * Runs captures and screen size changes one at a time. A capture that's in progress
 * when the size changes may never finish. Rejects if `task` takes too long.
 */
function inTurn(tab, task) {
  const run = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome did not respond')), CAPTURE_TIMEOUT_MS);
    task().then(resolve, reject).finally(() => clearTimeout(timer));
  });
  const result = (tab.turn || Promise.resolve()).then(run, run);
  tab.turn = result.catch(() => {});
  return result;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(Number(value) * 100) / 100 || min));
}

function lowercaseKeys(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
}
