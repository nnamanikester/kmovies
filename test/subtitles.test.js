import assert from 'node:assert/strict';
import test from 'node:test';
import { dropEarlierSubtitles, findSubtitleLinks, replaceOlderLists, isSubtitleResponse, parseSubtitles } from '../server/subtitles.js';

test('parseSubtitles reads SRT, removing styling', () => {
  const cues = parseSubtitles('﻿1\r\n00:00:01,500 --> 00:00:03,000\r\n<i>Hello</i>\r\nthere\r\n\r\n2\r\n01:00:00,000 --> 01:00:02,250\r\n{\\an8}Later\r\n');
  assert.deepEqual(cues, [
    { start: 1.5, end: 3, text: 'Hello\nthere' },
    { start: 3600, end: 3602.25, text: 'Later' },
  ]);
});

test('parseSubtitles reads WebVTT, with short timestamps and settings', () => {
  const cues = parseSubtitles('WEBVTT\n\nNOTE a comment\n\nintro\n00:01.000 --> 00:02.000 align:start\nHi\n');
  assert.deepEqual(cues, [{ start: 1, end: 2, text: 'Hi' }]);
});

test('parseSubtitles reads ASS dialogue, keeping commas in the text', () => {
  const ass = '[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:05.50,0:00:07.00,Default,,0,0,0,,{\\i1}One, two\\Nthree\n';
  assert.deepEqual(parseSubtitles(ass), [{ start: 5.5, end: 7, text: 'One, two\nthree' }]);
});

test('parseSubtitles returns nothing for a file that isn’t subtitles', () => {
  assert.deepEqual(parseSubtitles('<html>Not found</html>'), []);
});

test('findSubtitleLinks reads a caption list like MovieBox’s', () => {
  const body = JSON.stringify({ code: 0, data: { captions: [
    { id: '1', lan: 'en', lanName: 'English', url: 'https://cdn.example.com/a.srt?Policy=x' },
    { id: '2', lan: 'ar', lanName: 'Arabic', url: 'https://cdn.example.com/b.vtt' },
  ] } });
  assert.deepEqual(findSubtitleLinks(body), [
    { url: 'https://cdn.example.com/a.srt?Policy=x', language: 'en', label: 'English' },
    { url: 'https://cdn.example.com/b.vtt', language: 'ar', label: 'Arabic' },
  ]);
});

test('findSubtitleLinks handles other players’ shapes', () => {
  const jw = JSON.stringify({ tracks: [{ file: 'https://x.com/subs?id=1', kind: 'captions', label: 'French', language: 'fr' }] });
  assert.deepEqual(findSubtitleLinks(jw), [{ url: 'https://x.com/subs?id=1', language: 'fr', label: 'French' }]);
  const other = JSON.stringify({ subtitles: [{ src: 'https://x.com/e.vtt', srclang: 'es', name: 'Español' }] });
  assert.deepEqual(findSubtitleLinks(other), [{ url: 'https://x.com/e.vtt', language: 'es', label: 'Español' }]);
});

test('findSubtitleLinks ignores unrelated and invalid JSON', () => {
  assert.deepEqual(findSubtitleLinks('{"poster":"https://x.com/a.jpg"}'), []);
  assert.deepEqual(findSubtitleLinks('not json .srt'), []);
});

test('dropEarlierSubtitles keeps only those found around the new video', () => {
  const tracks = [{ id: 'episode-1', foundAt: 1000 }, { id: 'episode-2', foundAt: 90000 }];
  assert.deepEqual(dropEarlierSubtitles(tracks, 95000, 15000).map((track) => track.id), ['episode-2']);
});

test('a newer list replaces older ones in the same languages', () => {
  const tracks = [
    { id: 'old-english', batch: 1, language: 'en', label: 'English' },
    { id: 'old-arabic', batch: 1, language: 'ar', label: 'Arabic' },
    { id: 'new-english', batch: 2, language: 'en', label: 'English' },
    { id: 'track-tag', batch: null, language: 'en', label: 'English' },
  ];
  assert.deepEqual(replaceOlderLists(tracks, 2, new Set(['en'])).map((track) => track.id), ['old-arabic', 'new-english', 'track-tag']);
});

test('isSubtitleResponse uses the type or the file name', () => {
  assert.equal(isSubtitleResponse('https://x.com/a.srt?sig=1'), true);
  assert.equal(isSubtitleResponse('https://x.com/a', 'text/vtt'), true);
  assert.equal(isSubtitleResponse('https://x.com/a', 'application/x-subrip'), true);
  assert.equal(isSubtitleResponse('https://x.com/a.js', 'text/javascript'), false);
});
