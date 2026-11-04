import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WatchProgress, isWatched, videoKeys } from '../server/progress.js';

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kmovies-progress-')), 'progress.json');
const MOVIE = { sourceUrl: 'https://cdn.x.com/a/movie.mp4?token=1', pageUrl: 'https://x.com/watch?id=7&ep=', title: 'A Movie' };

test('videoKeys ignores changing tokens and empty address parts', () => {
  const [stream, page] = videoKeys(MOVIE);
  assert.equal(stream, 'stream:cdn.x.com/a/movie.mp4');
  assert.equal(page, 'page:https://x.com/watch?id=7');
  assert.deepEqual(videoKeys({ ...MOVIE, sourceUrl: 'https://cdn.x.com/a/movie.mp4?token=2' })[0], stream);
});

test('videoKeys tells episodes on one page apart, by title too', () => {
  const one = videoKeys({ ...MOVIE, episode: { season: 1, episode: 1 } });
  const three = videoKeys({ ...MOVIE, episode: { season: 1, episode: 3 } });
  assert.notEqual(one[1], three[1]);
  assert.equal(three[2], 'title:x.com|A Movie#S1E3');
  assert.equal(videoKeys(MOVIE).length, 2, 'a title with no episode names nothing reliably');
});

test('saves, survives a restart, and finds the latest point', () => {
  const where = file();
  const progress = new WatchProgress(where);
  const keys = videoKeys(MOVIE);
  progress.save(keys, 600, 3000, 'A Movie');
  progress.save(keys, 700, 3000, 'A Movie');
  progress.writeNow();
  assert.equal(new WatchProgress(where).find(keys, 3000).position, 700);
});

test('finds it under another name when the stream link has changed', () => {
  const progress = new WatchProgress(file());
  progress.save(videoKeys({ ...MOVIE, episode: { season: 1, episode: 3 } }), 600, 3000, 'A Movie');
  const changed = videoKeys({ ...MOVIE, sourceUrl: 'https://other.com/new.m3u8', episode: { season: 1, episode: 3 } });
  assert.equal(progress.find(changed, 3000).position, 600);
});

test('a different video on the same page isn’t mistaken for it', () => {
  const progress = new WatchProgress(file());
  progress.save(videoKeys(MOVIE), 600, 3000, 'A Movie');
  const other = videoKeys({ ...MOVIE, sourceUrl: 'https://cdn.x.com/b/other.mp4' });
  assert.equal(progress.find(other, 2500), null, 'a different length');
  assert.equal(progress.find(other, null), null, 'an unknown length');
  assert.equal(progress.find(videoKeys(MOVIE), null).position, 600, 'its own stream, length unknown');
});

test('skips the very start, short clips and live video, and forgets watched videos', () => {
  const progress = new WatchProgress(file());
  const keys = videoKeys(MOVIE);
  progress.save(keys, 5, 3000, 'x');
  assert.equal(progress.find(keys, 3000), null);
  progress.save(keys, 30, 60, 'x');
  assert.equal(progress.find(keys, 60), null);
  progress.save(keys, 30, null, 'x');
  assert.equal(progress.find(keys, null), null);
  progress.save(keys, 600, 3000, 'x');
  progress.save(keys, 2900, 3000, 'x');
  assert.equal(progress.find(keys, 3000), null);
});

test('names known only later still move and clear together', () => {
  const progress = new WatchProgress(file());
  const full = videoKeys({ ...MOVIE, episode: { season: 1, episode: 3 } });
  const early = videoKeys(MOVIE);
  progress.save(full, 600, 3000, 'A Movie');

  // Moments after starting, before the episode is known.
  progress.save(early, 700, 3000, 'A Movie');
  assert.equal(progress.find(full, 3000).position, 700);

  progress.clear(early);
  assert.equal(progress.find(full, 3000), null, 'finished, so no name brings it back');
});

test('another video never shares names with it', () => {
  const progress = new WatchProgress(file());
  const one = videoKeys({ ...MOVIE, episode: { season: 1, episode: 1 } });
  const two = videoKeys({ ...MOVIE, sourceUrl: 'https://cdn.x.com/b.mp4', episode: { season: 1, episode: 2 } });
  progress.save(one, 600, 3000, 'A Movie');
  progress.save(two, 900, 3000, 'A Movie');
  progress.clear(two);
  assert.equal(progress.find(one, 3000).position, 600);
});

test('videos on one unchanging page address stay separate', () => {
  const progress = new WatchProgress(file());
  const page = { pageUrl: 'https://x.com/show?id=7', title: 'Show' };
  const one = videoKeys({ ...page, sourceUrl: 'https://cdn.x.com/1.m3u8' });
  const two = videoKeys({ ...page, sourceUrl: 'https://cdn.x.com/2.m3u8' });
  progress.save(one, 600, 3000, 'Show');
  progress.save(two, 900, 3000, 'Show');
  assert.equal(progress.find(one, 3000).position, 600, 'its own stream comes first');
  progress.clear(two);
  assert.equal(progress.find(one, 3000).position, 600, 'clearing one leaves the other');
});

test('isWatched at 95% or the last 30 seconds', () => {
  assert.equal(isWatched(2850, 3000), true);
  assert.equal(isWatched(2849, 3000), false);
  assert.equal(isWatched(155, 180), true);
  assert.equal(isWatched(100, 180), false);
});
