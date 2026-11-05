# KMovies

Browse any website from a web app on your phone. When a video starts playing, it's picked up and
cast to the KMovies app on your LG webOS TV, and you control it from the web app.

```
 Phone (web app)                 Your computer                     TV (KMovies app)
┌────────────────┐  screen     ┌──────────────────────┐  video   ┌────────────────┐
│ address bar    │ ◄────────── │ Real Chrome browses  │ ───────► │ Plays the      │
│ page you browse│  taps, keys │ the site, reports    │  signals │ stream, follows│
│ cast controls  │ ──────────► │ video requests       │ ◄──────► │ signals        │
└────────────────┘             │ Relay adds the       │  status  └────────────────┘
                               │ Referer and cookies  │
                               └──────────────────────┘
```

- **A web page can't see another site's video requests**, so a real Chrome on your computer does the
  browsing and the web app shows its screen. Sites run unmodified and you stay signed in between runs.
- **The relay** exists because a TV `<video>` can't send the Referer and cookies video sites require.
- **Playback is controlled on the TV, and the web app can be closed while casting.** The computer has to stay on and awake, since the video
  passes through it. KMovies prevents idle sleep on a Mac, but closing the lid still sleeps it.

## Use it

You need Node.js 18+, Google Chrome, and an LG TV on the same network as your computer.

```bash
npm install   # first time only
npm start
```

That one command does everything: it builds, finds the TV, installs the app if it changed, opens it on
the TV with this computer's current address, starts the server and opens the web app in your browser.
It keeps watching, so a TV turned on later or a change of network connects by itself. Press Ctrl+C to stop.

Go to a website in the web app and press play on a video. It starts on the TV.

## The browser

- **Your keyboard goes straight to the website.** Click a field and type. Shortcuts, copy and paste work.
- **Tabs, an address bar with suggestions from your history and bookmarks, and a start page** of your bookmarks and most visited sites. Open tabs come back next time.
- **Shortcuts:** `Cmd/Ctrl+L` address bar, `Cmd/Ctrl+R` reload, `Cmd/Ctrl+[` and `]` back and forward. Your own browser keeps the ones it reserves, like `Cmd/Ctrl+T`, so use the **+** button for a new tab.
- **Pop-ups** open as a tab: in front for the same site, behind for any other, so ads don't take over.
- **Sites remember you.** Logins, cookies, site storage and cache are kept in `.kmovies/chrome-profile`, like a normal browser profile, along with cookies that normally end with a browser session. Sign out on the site to clear a login, or delete `.kmovies/` to clear everything.

Touchscreens can browse, but typing needs a physical keyboard.


## Controls on the TV

| Remote | With controls hidden | With controls showing |
| --- | --- | --- |
| **Left / Right** | Back / forward 10 seconds | Move between buttons, or move along the seek bar |
| **Up / Down** | Show controls | Up: seek bar. Down: buttons |
| **OK** | Pause or play | Press the selected button |
| **Back** | Show controls, on Stop | Hide controls, or close the subtitle panel |

The Magic Remote pointer works on everything. Play, pause, stop, rewind and fast-forward keys work too.
The buttons are start from beginning, back 10, play/pause, forward 10, stop, subtitles (CC), video quality and playback speed.

**Video quality** lists whatever the stream offers, with Auto to let the player choose. If the page has offered other versions of the video, they appear too, and switching continues from the same point. A site serving one fixed file has nothing to choose from, and the panel says so.

## Continuing where you left off

Every video starts where you stopped, on any site. The TV shows **Continuing from 12:34** for a moment. To start over, on any video, bring up the controls with the remote and press the refresh icon at the start of the row, labelled **Start from beginning** when highlighted.

The point is saved every 10 seconds and when you pause or stop, in `.kmovies/watch-progress.json` on your computer. Each episode has its own. A video counts as watched from 95% or the last 30 seconds, and then starts from the beginning next time. Clips under 2 minutes and live video aren't saved. Delete the file to forget everything.

## Next episode

When an episode nears its end, the TV shows **Next episode in 10s** with **Play now** and **Cancel**. After the last episode of a season it moves to the next season. After three episodes with no button pressed it asks **Are you still watching?**

The **EP** button lists seasons and episodes, and has next, previous, autoplay on or off, and how long before the end the card appears. These are remembered on the TV.

This works from how the website's page is built, so it isn't tied to any one site. It looks for a numbered episode list and season menu, a "Next episode" button, an episode number in the address, and finally lets the site's own player move on. A step only counts if a new video really starts. If none does, the TV says so and offers **Try again** or **Stop**, rather than guess. Episodes a site requires a sign-in or Premium for need that on the site; KMovies doesn't get around them.

## Subtitles

Press **CC** on the TV to choose or turn them off. They come from:

- **This website:** subtitle files the page loads, `<track>` tags, player settings in its HTML, and caption lists in its data, on any site.
- **This video:** tracks inside the stream.
- **Your computer:** `.srt`, `.vtt` or `.ass` files in the project's `subtitles/` folder. Choose **Refresh list** after adding one.
- **Online search:** OpenSubtitles. Get a free API key at [opensubtitles.com](https://www.opensubtitles.com/consumers) and save it in `.kmovies/opensubtitles-key`.

You can adjust the delay, size and background from the same panel. The TV remembers the size,
background and your language, and turns on that language by itself when a video offers it.

## What gets cast automatically

To keep ads and previews off the TV, a stream auto-casts only if it follows something you did in the
last 30 seconds, nothing is already casting, and it's at least 2 minutes long or 30 MB. Everything
else appears under **Videos found on this page**, with a **Cast** button. Turn off **Auto-cast** to always choose.

## Limits

- **Any site is the goal, but not every site will work.** Nothing is specific to one site: videos are recognised by their type, name or contents, on any page. Sites that detect automated browsers may refuse to load, and players that hide their stream in unusual ways won't be picked up.
- **DRM-protected video** (Netflix and similar) is labelled and can't be cast.
- **Streams:** HLS, DASH and direct files (MP4, WebM) are supported.
- **Formats** depend on what the TV can decode.
- **Audio tracks** can't be switched yet; the stream's default plays.
- **Google sign-in** may refuse a browser under automation; use another sign-in method if so.
- **Anyone with the link** can control the browser, including your signed-in sites. It holds an access
  token, so don't share it. Delete `.kmovies/secrets.json` to replace it, then run `npm start` again.

## TV setup (one time)

1. On the TV, install **Developer Mode** from the LG Content Store and sign in with a free
   [LG developer account](https://webostv.developer.lge.com).
2. Turn on **Dev Mode Status**, let the TV restart, then turn on **Key Server**.
3. Run `npm start` in a terminal. It finds the TV and asks for the passphrase shown in the Developer Mode app.

Each computer you use pairs once in the same way. After that, `npm start` needs nothing from you.

Developer Mode expires, so press **Extend** in its app now and then.

You don't need to know any addresses. `npm start` searches this computer's network for the TV,
confirms it with its paired SSH key, and tells the app this computer's current address when it opens it.
The TV and computer must be on the same network.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Does everything: builds, connects the TV, serves |
| `npm run tv:inspect` | Chrome DevTools for the app on the TV |
| `npm test` | Unit tests |
| `FFMPEG=/path/to/ffmpeg npm run test:e2e` | Runs the whole flow against a local test site |

Set `KMOVIES_SHOW_CHROME=1` with `npm start` to watch the Chrome window while debugging.

## Troubleshooting

- **TV says "Looking for your computer":** check `npm start` is running, and allow Node through the firewall if macOS asks.
- **Video won't start on the TV:** the web app shows the reason. Try a different entry under **Videos found on this page**.
- **`npm start` can't find the TV:** it keeps trying and prints which of these applies: the TV is off or on another network, Developer Mode is off or expired, or the key needs fetching again.

The previous version, a proxy that ran one site on the TV, is in `legacy/` and can be deleted.
