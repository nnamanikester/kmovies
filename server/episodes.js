/**
 * Finds the next episode on any website, from how pages are built rather than
 * from any one site's names. Nothing here is taken on trust: an action only
 * counts once a new video actually starts loading (see CastManager.advance).
 */

const EPISODE_ADDRESS_PATTERNS = [
  { pattern: /([?&](?:ep|e|episode|episodeNumber)=)(\d+)/i, kind: 'episode' },
  { pattern: /(\/season[-_/]?\d+\/episode[-_/]?)(\d+)/i, kind: 'episode', season: /\/season[-_/]?(\d+)/i },
  { pattern: /(\/episode[-_/]?)(\d+)/i, kind: 'episode' },
  { pattern: /(\/ep[-_/]?)(\d+)/i, kind: 'episode' },
  { pattern: /(\bs\d{1,2}e)(\d{1,3})\b/i, kind: 'episode', season: /\bs(\d{1,2})e\d{1,3}\b/i },
];

/** The address of another episode, for sites where the episode is in the address. */
export function episodeAddress(url, step) {
  for (const { pattern, season } of EPISODE_ADDRESS_PATTERNS) {
    const match = pattern.exec(url);
    if (match) {
      const episode = Number(match[2]) + step;
      if (episode < 1) return null;
      const number = String(episode).padStart(match[2].length, '0');
      return {
        url: url.replace(pattern, `$1${number}`),
        episode,
        season: season && season.exec(url) ? Number(season.exec(url)[1]) : null,
      };
    }
  }
  return null;
}

/** The first episode of the next season, for addresses that name the season. */
export function nextSeasonAddress(url) {
  const combined = /\bs(\d{1,2})e(\d{1,3})\b/i.exec(url);
  if (combined) {
    const season = String(Number(combined[1]) + 1).padStart(combined[1].length, '0');
    const episode = '1'.padStart(combined[2].length, '0');
    return { url: url.replace(combined[0], `s${season}e${episode}`), season: Number(season), episode: 1 };
  }
  const separate = /(\/season[-_/]?)(\d+)(\/episode[-_/]?)(\d+)/i.exec(url);
  if (separate) {
    const season = Number(separate[2]) + 1;
    return { url: url.replace(separate[0], `${separate[1]}${season}${separate[3]}1`), season, episode: 1 };
  }
  return null;
}

export function episodeLabel({ season, episode }) {
  if (season && episode) return `S${season} E${episode}`;
  if (episode) return `Episode ${episode}`;
  if (season) return `Season ${season}`;
  return 'Next episode';
}

/**
 * Runs inside a frame of the page, so it can't use anything from this file.
 * Reads the page, and performs an action on it if asked.
 */
export function readEpisodesInPage(action, argument) {
  const EPISODE_LABEL = /^(?:(?:ep|eps|episode|e|ch|tập|episodio|épisode)[\s.:#-]*)?0*(\d{1,4})(?:\s*[-:.)].*)?$/i;
  const SEASON_EPISODE = /\bs\d{1,2}\s*[:.\-x]?\s*e(\d{1,4})\b/i;
  const NAMED_EPISODE = /\b(?:episode|ep)[\s.:#-]*0*(\d{1,4})\b/i;
  const SEASON_LABEL = /^(?:season|series|saison|temporada|staffel|s)[\s.:#-]*0*(\d{1,3})\b/i;
  const RANGE_LABEL = /^(\d{1,4})\s*[-~–—]\s*(\d{1,4})$/;
  const CURRENT_CLASS = /(^|[\s_-])(active|current|selected|playing|now-?playing|is-?active|on)($|[\s_-])/i;
  const NOT_EPISODES = /pagination|pager|paging|page-?(item|link|num)|comment|rating|review|calendar|carousel|slider|swiper|year/i;
  const SERIES_CONTEXT = /episode|season|series|\bep\b|playlist|tập/i;
  const CLICKABLE = 'a,button,[role="button"],[role="tab"],[role="option"],[role="menuitem"],[role="link"],[onclick],li,label';

  const isVisible = (el) => {
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
  };
  const textOf = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const nameOf = (el) => textOf(el) || el.getAttribute('aria-label') || el.getAttribute('title') || '';
  const isDisabled = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true' || /(^|\s)disabled(\s|$)/i.test(String(el.className));
  const classOf = (el) => (typeof el.className === 'string' ? el.className : (el.getAttribute('class') || ''));
  const contextOf = (el) => {
    const parts = [];
    let node = el;
    for (let i = 0; i < 4 && node; i += 1, node = node.parentElement) {
      parts.push(classOf(node), node.id || '', node.getAttribute('aria-label') || '');
    }
    return parts.join(' ');
  };
  const insidePlayer = (el) => {
    let node = el.parentElement;
    for (let i = 0; i < 5 && node; i += 1, node = node.parentElement) {
      if (node.querySelector('video') && !node.querySelector('h1,h2')) return true;
    }
    return false;
  };
  const climbToClickable = (el) => {
    let node = el;
    for (let i = 0; i < 4 && node; i += 1, node = node.parentElement) {
      if (node.matches(CLICKABLE) || getComputedStyle(node).cursor === 'pointer') return node;
    }
    return null;
  };
  const episodeNumberOf = (el) => {
    const text = nameOf(el);
    if (!text || text.length > 80) return null;
    const match = SEASON_EPISODE.exec(text) || NAMED_EPISODE.exec(text) || EPISODE_LABEL.exec(text);
    return match ? Number(match[1]) : null;
  };

  /* The items of a list that belong together: children of one parent. */
  const collectLeaves = (test) => {
    const found = new Map();
    document.querySelectorAll('body *').forEach((el) => {
      if (el.children.length > 3 || !isVisible(el)) return;
      const value = test(el);
      if (value === null) return;
      let target = climbToClickable(el);
      // An item is often wrapped, as in <li><a>: the wrapper is what sits beside the others.
      for (let i = 0; target && i < 3 && target.parentElement && target.parentElement !== document.body && target.parentElement.children.length === 1; i += 1) {
        target = target.parentElement;
      }
      if (target && !found.has(target) && isVisible(target)) found.set(target, value);
    });
    return found;
  };

  const looksCurrent = (el) => el.getAttribute('aria-current') && el.getAttribute('aria-current') !== 'false'
    || el.getAttribute('aria-selected') === 'true'
    || el.getAttribute('aria-pressed') === 'true'
    || el.getAttribute('data-active') === 'true'
    || el.getAttribute('data-current') === 'true'
    || CURRENT_CLASS.test(classOf(el));

  const looksOf = (el) => {
    const style = getComputedStyle(el);
    return `${style.backgroundColor}|${style.color}|${style.borderTopColor}|${style.fontWeight}`;
  };

  /** Which item is current: marked as such, the only one without a number, or the one styled differently. */
  const findCurrentIndex = (items) => {
    const marked = items.map((item, index) => (looksCurrent(item.el) ? index : -1)).filter((index) => index !== -1);
    if (marked.length === 1) return marked[0];
    const unnumbered = items.map((item, index) => (item.inferred ? index : -1)).filter((index) => index !== -1);
    if (unnumbered.length === 1) return unnumbered[0];
    if (items.length >= 3) {
      const counts = new Map();
      items.forEach((item) => {
        const looks = looksOf(item.el);
        counts.set(looks, (counts.get(looks) || 0) + 1);
      });
      const unusual = items.map((item, index) => (counts.get(looksOf(item.el)) === 1 ? index : -1)).filter((index) => index !== -1);
      if (unusual.length === 1 && counts.size === 2) return unusual[0];
    }
    return -1;
  };

  const findEpisodeList = () => {
    const leaves = collectLeaves(episodeNumberOf);
    const groups = new Map();
    leaves.forEach((number, el) => {
      if (!el.parentElement) return;
      if (!groups.has(el.parentElement)) groups.set(el.parentElement, []);
      groups.get(el.parentElement).push({ el, number, label: nameOf(el) });
    });

    let best = null;
    groups.forEach((numbered, parent) => {
      const known = new Map(numbered.map((item) => [item.el, item]));
      // Include siblings with no number: often the one now playing shows an icon instead.
      const tag = numbered[0].el.tagName;
      const items = Array.from(parent.children)
        .filter((child) => child.tagName === tag && isVisible(child))
        .map((child) => known.get(child) || { el: child, number: null, label: nameOf(child), inferred: true });
      if (items.length < 2 || numbered.length < 1) return;
      if (items.filter((item) => item.inferred).length > 1) return;
      if (insidePlayer(parent) || NOT_EPISODES.test(contextOf(parent))) return;

      // Numbers should count up or down by one.
      const direction = numbered.length > 1 && numbered[0].number > numbered[1].number ? -1 : 1;
      items.forEach((item, index) => {
        if (item.number !== null) return;
        const neighbour = items[index + 1] && items[index + 1].number !== null ? { offset: 1, item: items[index + 1] } : items[index - 1] && items[index - 1].number !== null ? { offset: -1, item: items[index - 1] } : null;
        item.number = neighbour ? neighbour.item.number - neighbour.offset * direction : null;
      });
      if (items.some((item) => item.number === null)) return;
      let inOrder = 0;
      items.forEach((item, index) => {
        if (index && item.number - items[index - 1].number === direction) inOrder += 1;
      });
      if (inOrder / (items.length - 1) < 0.7) return;

      // The word "Season" or "Episode" can sit a few levels away from the numbers.
      let area = parent;
      for (let i = 0; i < 3 && area.parentElement && area.parentElement !== document.body; i += 1) area = area.parentElement;
      const nearbyText = textOf(area).slice(0, 600);
      const namesEpisodes = numbered.some((item) => /\D/.test(item.label) && (NAMED_EPISODE.test(item.label) || SEASON_EPISODE.test(item.label)));
      const hasContext = namesEpisodes || SERIES_CONTEXT.test(`${contextOf(parent)} ${nearbyText}`);
      const score = items.length + (hasContext ? 100 : 0);
      if (!hasContext || (best && best.score >= score)) return;
      best = { items, score, direction };
    });
    return best;
  };

  const findSeasons = () => {
    const select = Array.from(document.querySelectorAll('select')).find((el) => isVisible(el) && Array.from(el.options).filter((option) => SEASON_LABEL.test(option.text.trim())).length > 0);
    if (select) {
      const options = Array.from(select.options).filter((option) => SEASON_LABEL.test(option.text.trim())).map((option) => ({ number: Number(SEASON_LABEL.exec(option.text.trim())[1]), option }));
      const selected = options.find((item) => item.option.selected);
      return { select, options, current: selected ? selected.number : null };
    }
    const seasonOf = (el) => {
      const match = SEASON_LABEL.exec(nameOf(el));
      return match && nameOf(el).length < 40 ? Number(match[1]) : null;
    };
    const leaves = collectLeaves(seasonOf);
    const groups = new Map();
    leaves.forEach((number, el) => {
      if (!groups.has(el.parentElement)) groups.set(el.parentElement, []);
      groups.get(el.parentElement).push({ el, number });
    });
    let list = null;
    let toggle = null;
    groups.forEach((items) => {
      if (items.length >= 2 && (!list || items.length > list.length)) list = items;
      if (items.length === 1) toggle = items[0];
    });
    if (list) {
      const index = findCurrentIndex(list);
      const current = index !== -1 ? list[index].number : toggle ? toggle.number : null;
      return { options: list, current, toggle: toggle ? toggle.el : null };
    }
    if (toggle) return { options: [], current: toggle.number, toggle: toggle.el };
    return null;
  };

  const findNamedButton = (pattern) => {
    const candidates = Array.from(document.querySelectorAll('a,button,[role="button"]')).filter((el) => {
      if (!isVisible(el) || isDisabled(el)) return false;
      const words = `${nameOf(el)} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${classOf(el)}`;
      return pattern.test(words) && !/slide|page|carousel|swiper|next-?up-?close/i.test(`${classOf(el)} ${nameOf(el)}`);
    });
    return candidates[0] || null;
  };
  const NEXT_BUTTON = /\b(next[\s_-]*(episode|ep)\b|skip[\s_-]*to[\s_-]*next[\s_-]*episode|play[\s_-]*next[\s_-]*episode)/i;
  const PREVIOUS_BUTTON = /\b(prev(ious)?[\s_-]*(episode|ep)\b)/i;

  /* Press like a person does: sites may listen for any of these. */
  const press = (el) => {
    const box = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, view: window, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, button: 0 };
    // The handler is most likely on the link or button inside a wrapper.
    const target = el.matches('a,button,[role="button"]') ? el : el.querySelector('a,button,[role="button"]') || el;
    if (window.PointerEvent) target.dispatchEvent(new PointerEvent('pointerdown', { ...at, isPrimary: true }));
    target.dispatchEvent(new MouseEvent('mousedown', at));
    if (window.PointerEvent) target.dispatchEvent(new PointerEvent('pointerup', { ...at, isPrimary: true }));
    target.dispatchEvent(new MouseEvent('mouseup', at));
    target.click();
  };

  const list = findEpisodeList();
  const seasons = findSeasons();
  let currentIndex = list ? findCurrentIndex(list.items) : -1;
  if (list && currentIndex === -1 && argument && argument.currentEpisode) {
    currentIndex = list.items.findIndex((item) => item.number === argument.currentEpisode);
  }

  if (action === 'pressEpisode') {
    const item = list && list.items.find((candidate) => candidate.number === argument.number);
    if (!item) return false;
    press(item.el);
    return true;
  }
  if (action === 'pressFirstEpisode' || action === 'pressLastEpisode') {
    if (!list) return false;
    const wanted = action === 'pressFirstEpisode' ? -1 : 1;
    const chosen = list.items.reduce((best, item) => ((item.number - best.number) * wanted > 0 ? item : best));
    press(chosen.el);
    return chosen.number;
  }
  if (action === 'pressNamedButton') {
    const button = findNamedButton(argument.direction === 'next' ? NEXT_BUTTON : PREVIOUS_BUTTON);
    if (!button) return false;
    press(button);
    return true;
  }
  if (action === 'toggleSeasonMenu') {
    if (!seasons || !seasons.toggle) return false;
    press(seasons.toggle);
    return true;
  }
  if (action === 'pickSeason') {
    if (!seasons) return false;
    const option = seasons.options.find((item) => item.number === argument.number);
    if (!option) return false;
    if (seasons.select) {
      seasons.select.value = option.option.value;
      seasons.select.dispatchEvent(new Event('input', { bubbles: true }));
      seasons.select.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      press(option.el);
    }
    return true;
  }
  if (action === 'pressRange') {
    const ranges = Array.from(collectLeaves((el) => (RANGE_LABEL.test(nameOf(el)) ? nameOf(el) : null)).entries());
    const match = ranges.find(([, text]) => {
      const [, low, high] = RANGE_LABEL.exec(text);
      return argument.number >= Number(low) && argument.number <= Number(high);
    });
    if (!match) return false;
    press(match[0]);
    return true;
  }
  if (action === 'finishVideo') {
    const video = Array.from(document.querySelectorAll('video')).find((el) => el.duration > 0);
    if (!video) return false;
    video.muted = true;
    video.currentTime = Math.max(0, video.duration - 1.5);
    const started = video.play();
    if (started && started.catch) started.catch(() => {});
    return true;
  }

  const current = list && currentIndex !== -1 ? list.items[currentIndex] : null;
  const numbers = list ? list.items.map((item) => item.number) : [];
  return {
    score: list ? list.score : 0,
    episodes: numbers,
    currentEpisode: current ? current.number : null,
    seasons: seasons ? seasons.options.map((item) => item.number) : [],
    currentSeason: seasons ? seasons.current : null,
    hasSeasonMenu: Boolean(seasons && seasons.toggle),
    hasNextButton: Boolean(findNamedButton(NEXT_BUTTON)),
    hasPreviousButton: Boolean(findNamedButton(PREVIOUS_BUTTON)),
    hasRanges: Array.from(document.querySelectorAll('button,a,li,[role="tab"]')).some((el) => isVisible(el) && RANGE_LABEL.test(nameOf(el))),
    mentionsEpisodes: SERIES_CONTEXT.test(`${document.title} ${location.href}`),
  };
}

const MENU_SETTLE_MS = 350;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class EpisodeNavigator {
  /** @param {import('./browser.js').ChromeBrowser} chrome */
  constructor(chrome) {
    this.chrome = chrome;
  }

  /** Reads every frame of a tab, keeping the one with the best episode list. */
  async read(tabId, memory) {
    const tab = this.chrome.tabById(tabId);
    if (!tab || tab.dialog) return null;
    const frames = tab.page.frames();
    const results = await Promise.all(frames.map((frame) => frame.evaluate(readEpisodesInPage, 'read', { currentEpisode: memory?.episode })
      .then((info) => ({ frame, info }))
      .catch(() => null)));
    const usable = results.filter(Boolean);
    if (usable.length === 0) return null;
    return usable.reduce((best, result) => {
      const worth = ({ info }) => info.score + (info.hasNextButton ? 50 : 0) + (info.seasons.length ? 10 : 0);
      return worth(result) > worth(best) ? result : best;
    });
  }

  /** Performs an action in whichever frame reports the list. */
  async perform(tabId, action, argument, memory) {
    const found = await this.read(tabId, memory);
    if (!found) return false;
    return found.frame.evaluate(readEpisodesInPage, action, { ...argument, currentEpisode: memory?.episode }).catch(() => false);
  }

  /** A season menu closed behind a button lists its seasons only while open. */
  async readSeasons(tabId, found, memory) {
    if (found.info.seasons.length || !found.info.hasSeasonMenu) return found.info.seasons;
    if (!(await this.perform(tabId, 'toggleSeasonMenu', {}, memory))) return [];
    await wait(MENU_SETTLE_MS);
    const opened = await this.read(tabId, memory);
    const { seasons = [] } = opened?.info || {};
    await this.perform(tabId, 'toggleSeasonMenu', {}, memory);
    return seasons;
  }

  /**
   * What the page offers from here.
   * @param {{ season?: number, episode?: number }} [memory] where the cast was last known to be
   */
  async look(tabId, memory) {
    const tab = this.chrome.tabById(tabId);
    const found = await this.read(tabId, memory);
    if (!tab || !found) return null;
    const { info } = found;
    const url = tab.url;
    const seasons = await this.readSeasons(tabId, found, memory);
    const episode = info.currentEpisode ?? memory?.episode ?? episodeAddress(url, 0)?.episode ?? null;
    const season = info.currentSeason ?? memory?.season ?? episodeAddress(url, 0)?.season ?? null;
    const current = { season, episode };
    const inList = episode !== null && info.episodes.includes(episode + 1);
    const laterSeason = seasons.filter((number) => number > (season ?? 0)).sort((a, b) => a - b)[0];
    const earlierSeason = seasons.filter((number) => number < (season ?? 0)).sort((a, b) => b - a)[0];
    const atListEnd = episode !== null && info.episodes.length > 0 && episode >= Math.max(...info.episodes);

    let next = null;
    if (inList) next = { season, episode: episode + 1, via: 'list' };
    else if (info.hasRanges && episode !== null) next = { season, episode: episode + 1, via: 'range' };
    else if (atListEnd && laterSeason) next = { season: laterSeason, episode: 1, via: 'season' };
    else if (info.hasNextButton) next = { season, episode: episode === null ? null : episode + 1, via: 'button' };
    else if (episodeAddress(url, 1) && !info.episodes.length) next = { season, episode: episodeAddress(url, 1).episode, via: 'address' };

    let previous = null;
    if (episode !== null && info.episodes.includes(episode - 1)) previous = { season, episode: episode - 1, via: 'list' };
    else if (info.hasPreviousButton) previous = { season, episode: episode === null ? null : episode - 1, via: 'button' };
    else if (episode > 1 && episodeAddress(url, -1) && !info.episodes.length) previous = { season, episode: episode - 1, via: 'address' };
    else if (earlierSeason && episode === Math.min(...info.episodes)) previous = { season: earlierSeason, episode: null, via: 'season' };

    return {
      current,
      next,
      previous,
      episodes: info.episodes,
      seasons,
      // Worth a last try at the very end: the site itself may move on.
      looksLikeSeries: info.episodes.length > 0 || seasons.length > 0 || info.mentionsEpisodes,
      seriesEnd: atListEnd && !laterSeason && !info.hasNextButton && (seasons.length > 0 || info.episodes.length > 1),
    };
  }

  /* ---------- acting on the page; a new stream is what proves it worked ---------- */

  async goToSeason(tabId, number, memory) {
    const found = await this.read(tabId, memory);
    if (!found) return false;
    if (!found.info.seasons.includes(number) && found.info.hasSeasonMenu) {
      await this.perform(tabId, 'toggleSeasonMenu', {}, memory);
      await wait(MENU_SETTLE_MS);
    }
    return this.perform(tabId, 'pickSeason', { number }, memory);
  }

  pressEpisode(tabId, number, memory) {
    return this.perform(tabId, 'pressEpisode', { number }, memory);
  }

  pressFirstEpisode(tabId, memory) {
    return this.perform(tabId, 'pressFirstEpisode', {}, memory);
  }

  pressLastEpisode(tabId, memory) {
    return this.perform(tabId, 'pressLastEpisode', {}, memory);
  }

  pressRange(tabId, number, memory) {
    return this.perform(tabId, 'pressRange', { number }, memory);
  }

  pressNamedButton(tabId, direction, memory) {
    return this.perform(tabId, 'pressNamedButton', { direction }, memory);
  }

  /** Lets the site's own player reach its end, in case the site moves on by itself. */
  finishVideo(tabId) {
    return this.perform(tabId, 'finishVideo', {});
  }
}
