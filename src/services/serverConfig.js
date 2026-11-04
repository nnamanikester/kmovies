const STORAGE_KEY = 'kmovies-server';

function launchParams() {
  const system = window.webOSSystem || window.PalmSystem;
  const raw = system && system.launchParams;
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return {};
  }
}

function fromAddress() {
  const params = new URLSearchParams(window.location.search);
  return { server: params.get('server'), token: params.get('token') };
}

function saved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

/**
 * Where the KMovies server is. `npm start` passes this when it opens the app;
 * it's remembered for when the app is opened from the TV's launcher instead.
 * @returns {{ server: string|null, token: string|null }}
 */
export function readServerConfig() {
  const params = launchParams();
  const address = fromAddress();
  const given = (params.server && params) || (address.server && address);
  if (!given) return saved();
  const config = { server: given.server, token: given.token };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    // Still works for this run.
  }
  return config;
}
