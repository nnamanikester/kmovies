import assert from 'node:assert/strict';
import test from 'node:test';
import { MEDIA_TYPE, classifyResponse, normalizeAddress, parseDash, parseHls, rewriteDash, rewriteHls, sniffManifest, totalBytes } from '../server/media.js';

const BASE = 'https://cdn.example.com/show/master.m3u8';

test('classifyResponse recognises whole videos and ignores segments', () => {
  assert.equal(classifyResponse(BASE), MEDIA_TYPE.HLS);
  assert.equal(classifyResponse('https://a.com/x', 'application/vnd.apple.mpegurl'), MEDIA_TYPE.HLS);
  assert.equal(classifyResponse('https://a.com/x.mpd'), MEDIA_TYPE.DASH);
  assert.equal(classifyResponse('https://a.com/x', 'video/mp4'), MEDIA_TYPE.FILE);
  assert.equal(classifyResponse('https://a.com/seg1.ts', 'video/mp2t'), null);
  assert.equal(classifyResponse('https://a.com/seg1.m4s', 'video/iso.segment'), null);
  assert.equal(classifyResponse('https://a.com/app.js', 'text/javascript'), null);
});

test('totalBytes prefers the full size from a range response', () => {
  assert.equal(totalBytes({ 'content-range': 'bytes 0-99/5000', 'content-length': '100' }), 5000);
  assert.equal(totalBytes({ 'content-length': '100' }), 100);
  assert.equal(totalBytes({}), null);
});

test('parseHls reads masters, durations and live streams', () => {
  const master = parseHls('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow/index.m3u8\n', BASE);
  assert.equal(master.isMaster, true);
  assert.deepEqual(master.variants, ['https://cdn.example.com/show/low/index.m3u8']);

  const withAudio = parseHls('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="en",URI="aud.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="a"\nlow.m3u8\n', BASE);
  assert.deepEqual(withAudio.streams, ['https://cdn.example.com/show/low.m3u8']);
  assert.deepEqual(withAudio.variants, ['https://cdn.example.com/show/aud.m3u8', 'https://cdn.example.com/show/low.m3u8']);

  const vod = parseHls('#EXTM3U\n#EXTINF:10.5,\na.ts\n#EXTINF:9.5,\nb.ts\n#EXT-X-ENDLIST\n', BASE);
  assert.equal(vod.duration, 20);
  assert.equal(vod.isLive, false);

  const live = parseHls('#EXTM3U\n#EXTINF:10,\na.ts\n', BASE);
  assert.equal(live.isLive, true);
  assert.equal(live.duration, null);
});

test('parseHls separates DRM from plain AES encryption', () => {
  const key = (attrs) => parseHls(`#EXTM3U\n#EXT-X-KEY:${attrs}\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST`, BASE).hasDrm;
  assert.equal(key('METHOD=AES-128,URI="k"'), false);
  assert.equal(key('METHOD=AES-128,URI="k",KEYFORMAT="identity"'), false);
  assert.equal(key('METHOD=SAMPLE-AES,URI="skd://x",KEYFORMAT="com.apple.streamingkeydelivery"'), true);
  assert.equal(key('METHOD=SAMPLE-AES-CTR,URI="data:x",KEYFORMAT="urn:uuid:edef8ba9"'), true);
});

test('rewriteHls relays segments and URIs inside tags', () => {
  const out = rewriteHls('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k.bin"\n#EXTINF:1,\nseg.ts?a=1\n', BASE, (u) => `R(${u})`);
  assert.match(out, /URI="R\(https:\/\/cdn\.example\.com\/show\/k\.bin\)"/);
  assert.match(out, /^R\(https:\/\/cdn\.example\.com\/show\/seg\.ts\?a=1\)$/m);
});

test('parseDash reads length, live streams and DRM', () => {
  const vod = parseDash('<MPD type="static" mediaPresentationDuration="PT49M41.4S"><Period/></MPD>');
  assert.equal(Math.round(vod.duration), 2981);
  assert.equal(vod.isLive, false);
  assert.equal(vod.hasDrm, false);
  assert.equal(parseDash('<MPD mediaPresentationDuration="PT1H0M0S"/>').duration, 3600);
  assert.equal(parseDash('<MPD type="dynamic" minimumUpdatePeriod="PT2S"/>').isLive, true);
  assert.equal(parseDash('<MPD><ContentProtection schemeIdUri="x"/></MPD>').hasDrm, true);
});

test('rewriteDash points relative segments and absolute BaseURLs at the relay', () => {
  const mpd = '<?xml version="1.0"?>\n<MPD xmlns="a" type="static"><Location>https://x/y</Location><Period><BaseURL>https://other.example.com/v/</BaseURL></Period></MPD>';
  const out = rewriteDash(mpd, 'https://cdn.example.com/show/index.mpd', (dir) => `R(${dir})`);
  assert.match(out, /<MPD xmlns="a" type="static"><BaseURL>R\(https:\/\/cdn\.example\.com\/show\/\)<\/BaseURL>/);
  assert.match(out, /<BaseURL>R\(https:\/\/other\.example\.com\/v\/\)<\/BaseURL>/);
  assert.doesNotMatch(out, /Location/);
});

test('sniffManifest recognises playlists by content', () => {
  assert.equal(sniffManifest('#EXTM3U\n#EXTINF:1,\na.ts'), MEDIA_TYPE.HLS);
  assert.equal(sniffManifest('<?xml version="1.0"?>\n<!-- by x -->\n<MPD type="static"></MPD>'), MEDIA_TYPE.DASH);
  assert.equal(sniffManifest('{"a":1}'), null);
  assert.equal(sniffManifest('<html><body>MPD</body></html>'), null);
});

test('normalizeAddress adds a scheme, searches plain text and refuses other schemes', () => {
  assert.equal(normalizeAddress('example.com/a'), 'https://example.com/a');
  assert.equal(normalizeAddress('http://example.com'), 'http://example.com/');
  assert.equal(normalizeAddress('localhost:3000'), 'https://localhost:3000/');
  assert.match(normalizeAddress('funny cat videos'), /^https:\/\/duckduckgo\.com\/\?q=funny/);
  assert.equal(normalizeAddress('file:///etc/passwd'), null);
  assert.equal(normalizeAddress('chrome://settings'), null);
  assert.equal(normalizeAddress('javascript:alert(1)'), null);
  assert.equal(normalizeAddress(''), null);
});
