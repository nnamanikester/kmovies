/** Single source of truth for app-level settings. */
export const APP_CONFIG = Object.freeze({
  /** Display name shown on the TV. */
  APP_NAME: 'KMovies',

  /** How long (ms) to wait before reconnecting to the server. */
  RECONNECT_DELAY_MS: 3000,

  /** How often (ms) the TV reports its position to the web app. */
  STATUS_INTERVAL_MS: 1000,

  /** How long (ms) the playback controls stay up with nothing pressed. */
  CONTROLS_DURATION_MS: 6000,

  /** How long (ms) the position stays up after a skip. */
  PEEK_DURATION_MS: 2500,

  /** Seconds moved per press on the seek bar, and the wait (ms) before it jumps there. */
  SCRUB_STEP_SECONDS: 30,
  SCRUB_COMMIT_DELAY_MS: 900,

  /** Playback speeds the Speed button cycles through. */
  SPEEDS: [1, 1.25, 1.5, 2, 0.75],

  /** Seconds before the end at which "next episode" can appear, and the countdown once it does. */
  UP_NEXT_LEAD_OPTIONS: [15, 30, 60, 90, 120],
  UP_NEXT_COUNTDOWN_SECONDS: 10,

  /** Below this length, a video is too short to treat its ending as credits. */
  UP_NEXT_MIN_DURATION_SECONDS: 90,

  /** Episodes that start by themselves before asking "Are you still watching?". */
  STILL_WATCHING_AFTER: 3,

  /** How long "You've finished this series" stays before returning to the waiting screen. */
  FINISHED_DURATION_MS: 12000,

  /** How long "Continuing from..." stays up. */
  RESUMED_NOTICE_MS: 10000,

  /** Seconds skipped by the remote's left/right keys. */
  SKIP_SECONDS: 10,
});
