import assert from 'node:assert/strict';
import test from 'node:test';
import { episodeAddress, episodeLabel, nextSeasonAddress } from '../server/episodes.js';

test('episodeAddress finds the episode however the address names it', () => {
  assert.equal(episodeAddress('https://x.com/watch?id=7&ep=3', 1).url, 'https://x.com/watch?id=7&ep=4');
  assert.equal(episodeAddress('https://x.com/show/episode-9', 1).url, 'https://x.com/show/episode-10');
  assert.equal(episodeAddress('https://x.com/show/ep/4', -1).url, 'https://x.com/show/ep/3');
  assert.deepEqual(episodeAddress('https://x.com/show-s02e09-hd', 1), { url: 'https://x.com/show-s02e10-hd', episode: 10, season: 2 });
  assert.equal(episodeAddress('https://x.com/show/season-2/episode-5', 1).url, 'https://x.com/show/season-2/episode-6');
});

test('episodeAddress keeps zero padding, stops at 1 and ignores other numbers', () => {
  assert.equal(episodeAddress('https://x.com/show-s01e09', 1).url, 'https://x.com/show-s01e10');
  assert.equal(episodeAddress('https://x.com/?ep=1', -1), null);
  assert.equal(episodeAddress('https://x.com/movie/2024/123', 1), null);
  assert.equal(episodeAddress('https://x.com/?id=5&detailEp=', 1), null);
});

test('nextSeasonAddress starts the next season at episode 1', () => {
  assert.deepEqual(nextSeasonAddress('https://x.com/show-s01e10'), { url: 'https://x.com/show-s02e01', season: 2, episode: 1 });
  assert.equal(nextSeasonAddress('https://x.com/show/season-1/episode-8').url, 'https://x.com/show/season-2/episode-1');
  assert.equal(nextSeasonAddress('https://x.com/?ep=4'), null);
});

test('episodeLabel says as much as is known', () => {
  assert.equal(episodeLabel({ season: 2, episode: 3 }), 'S2 E3');
  assert.equal(episodeLabel({ episode: 3 }), 'Episode 3');
  assert.equal(episodeLabel({ season: 2 }), 'Season 2');
  assert.equal(episodeLabel({}), 'Next episode');
});
