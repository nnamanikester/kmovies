# KMovies — LG webOS TV app

A small React app for LG webOS TVs that opens **[MovieBox](https://themoviebox.xyz/)** full-screen and does nothing else.
You sign in once on the TV, and the TV remembers your session.

## How it works

LG TVs from 2020 (webOS 5) and earlier ship an old browser engine (Chrome 68). MovieBox
uses JavaScript this engine can't run, so opened directly the site loads, but posters,
search and the player don't work. This app bundles a **compatibility proxy** that runs
**on the TV** and fixes the site as it's loaded:

```
┌──────────────── KMovies app (React, file://) ────────────────┐
│ Splash → connectivity check → start proxy service (Luna)      │
│                    ↓                                          │
│  <iframe sandbox src="http://127.0.0.1:8765/">  + watchdog    │
└────────────────────│──────────────────────────────────────────┘
                     ↓
┌──── proxy service (Node.js on the TV, services/proxy) ────────┐
│ themoviebox.xyz, its CDN and API  ⇄  served from 127.0.0.1    │
│  • JS/CSS transpiled to Chrome 68 (native esbuild), cached    │
│  • polyfills + compatibility shims injected into every page   │
│  • ads/trackers blocked (CSP allow-list, ad slots removed)    │
│  • origin-dependent code patched, cookies fixed for http      │
└───────────────────────────────────────────────────────────────┘
```

- **The proxy service** (`services/proxy`) is a webOS JS service packaged inside the app.
  The app starts it via `luna://com.kmovies.tv.proxy/start` and keeps the subscription
  open; a watchdog restarts it if webOS ever stops it.
- **Ads and pop-unders:** pages get a Content-Security-Policy that only allows scripts and frames
  from the proxy itself (the site's own code) plus an explicit allow-list. Ad scripts,
  ad iframes and interstitials are refused by the browser. The iframe is sandboxed without
  `allow-top-navigation`/`allow-popups`, so nothing can hijack the app or open pop-unders.
- **Sign-in:** works with phone number / email. **Google sign-in will not work**, because
  Google only accepts sign-ins from the site's registered domain.
- **Remote:** the Magic Remote pointer works everywhere; Back moves through the site's history.

## Configuring the site — `src/config/site.config.json`

Everything site-specific lives in this one file and is passed to the proxy when it starts:

| Key | Purpose |
| --- | --- |
| `targetUrl` | The site to open |
| `assetOrigins` | CDNs whose JS/CSS must be transpiled (cookie-less, cached) |
| `apiOrigins` | Backend APIs the page calls directly (proxied to avoid CORS) |
| `allowedScriptOrigins` | Third-party scripts the site *needs* (e.g. the player's SDK) |
| `allowedFrameOrigins` | Third-party frames the site needs (e.g. YouTube trailers) |
| `blockedPaths` | Site paths answered with an empty page (its own ad slots) |
| `hiddenSelectors` | CSS selectors hidden on every page (ad containers) |
| `scriptPatches` | Find/replace applied to the site's scripts before transpiling |

If something on the site stops working, check the browser console (`npm run tv:inspect`):
a CSP error naming a domain means that domain needs to be added to an allow-list.

## Prerequisites

- **Node.js 18+** and npm
- An **LG webOS TV** (webOS 4.0 / 2018 models or newer) on the **same network** as your computer
- A free **LG developer account**: https://webostv.developer.lge.com (sign up at the top right)

The webOS CLI (`ares-*`) is installed locally as a dev dependency, so you don't need a global install.

## 1. Install

```bash
npm install
```

## 2. Try it on your computer (optional)

```bash
npm run dev:proxy     # terminal 1: the proxy, on http://127.0.0.1:8765
npm run dev           # terminal 2: the app
```

Open the URL Vite prints. You can also open http://127.0.0.1:8765 directly to test the
proxied site. Proxy logs and recent activity: http://127.0.0.1:8765/__kmovies/status.

## 3. Put the TV in Developer Mode (one-time)

1. On the TV, open the **LG Content Store**, search for **"Developer Mode"**, and install it.
2. Open the **Developer Mode** app and sign in with your LG developer account.
3. Turn on **Dev Mode Status**. The TV restarts.
4. Open Developer Mode again and turn on **Key Server**.
5. Note the **IP address** the app shows (for example `192.168.1.50`).

> ⏳ Developer Mode expires after a while (the app shows a countdown). Press
> **Extend** in the Developer Mode app from time to time, or the TV will remove dev apps when it runs out.

## 4. Connect your computer to the TV (one-time)

```bash
npm run tv:setup
```

Choose **add**, then answer the prompts:

| Prompt          | Answer                        |
| --------------- | ----------------------------- |
| Device Name     | `tv`                          |
| IP address      | the IP shown on the TV        |
| Port            | `9922` (default)              |
| ssh user        | `prisoner` (default)          |
| Description     | anything                      |
| Authentication  | `password`, then leave it empty |
| Set default?    | `Y`                           |

Then fetch the TV's SSH key. The **Key Server** must be on, and you enter the **Passphrase** the TV shows:

```bash
npx ares-novacom --device tv --getkey
```

Check the connection:

```bash
npx ares-device-info --device tv
```

## 5. Build, install and launch

```bash
npm run tv:deploy
```

This does three things:

1. `npm run package` builds the app, prepares the proxy service (downloads the esbuild ARM
   binary and builds the polyfills on first run), and creates `build/com.kmovies.tv_1.0.0_all.ipk`
2. `npm run tv:install` installs that `.ipk` on the TV
3. `npm run tv:launch` opens it

**KMovies** now appears in the TV's app launcher (Home ➜ apps row). Open it and sign in on the
MovieBox site. The magic remote pointer works best for typing in the sign-in form. You stay signed in across launches.

### Other commands

| Command                 | What it does                                                  |
| ----------------------- | ------------------------------------------------------------- |
| `npm run build`         | Builds the web app into `dist/`                               |
| `npm run package`       | Builds and creates the `.ipk` in `build/`                     |
| `npm run tv:install`    | Installs the latest `.ipk` on the TV                          |
| `npm run tv:launch`     | Opens the app on the TV                                       |
| `npm run tv:inspect`    | Opens Chrome DevTools connected to the app on the TV (debugging) |
| `npm run tv:uninstall`  | Removes the app from the TV                                   |
| `npm run icons`         | Regenerates `webos/*.png` from `scripts/generate-icons.mjs`   |
| `npm run dev:proxy`     | Runs the proxy on your computer                               |
| `npm run build:service` | Prepares `services/proxy/vendor` (add `-- --force` to rebuild) |

If your TV device isn't named `tv`, set it per command: `TV_DEVICE=livingroom npm run tv:install`.

## Customising

| I want to…                         | Change                                                   |
| ---------------------------------- | -------------------------------------------------------- |
| Open a different site              | `site.config.json` (and re-check its asset/API origins) |
| Rename the app                     | `APP_NAME` in `src/config/app.config.js` **and** `title` in `webos/appinfo.json` |
| Ship a new version                 | bump `version` in `webos/appinfo.json` and `services/proxy/package.json`, then `npm run tv:deploy` |
| Change colours                     | CSS variables in `src/styles/global.css`                 |
| Use your own icons                 | replace the PNGs in `webos/` (keep the same sizes)       |

## Troubleshooting

- **`ares-install` can't connect / times out**: check the TV is on, Developer Mode is still active
  (not expired), and the IP hasn't changed (`npm run tv:setup` → modify).
- **Authentication errors**: turn **Key Server** back on in the Developer Mode app and run
  `npx ares-novacom --device tv --getkey` again.
- **App shows "Can't reach KMovies"**: the TV can't reach the site. Check the TV's network.
  The screen retries on its own every 15 seconds, and right away when the network comes back.
- **The site misbehaves on the TV**: run `npm run tv:inspect` to debug the live page with Chrome DevTools.
  The site runs inside the app's iframe; pick the `127.0.0.1` frame in the console's context menu.
- **Proxy logs on the TV**: `/tmp/kmovies-proxy.log` (via `ssh` in Developer Mode), or
  `http://127.0.0.1:8765/__kmovies/status` from DevTools.
- **First launch is slow**: the TV transpiles the site's scripts once, then caches them.
- **"Something went wrong" screen**: the proxy service failed to start; it retries automatically.
