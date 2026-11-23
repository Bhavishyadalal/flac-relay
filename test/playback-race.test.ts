import assert from 'node:assert/strict';
import test from 'node:test';
import { InFlight } from '../src/cache.js';
import { normalizeTrack, upstreamIdFromPublicId } from '../src/normalize.js';
import { resolvePlayback, withRecordingHint } from '../src/providers/playback-race.js';
import type { QobuzProvider } from '../src/types.js';

const original = {
  upstreamId: 'main:main-id',
  title: 'One Kiss (with Dua Lipa)',
  artist: 'Calvin Harris, Dua Lipa',
  duration: 215,
};
const flac = { url: 'https://audio.example/one-kiss.flac', format: 'flac' };
const active = () => true;

function publicRoute() {
  const track = normalizeTrack(withRecordingHint(original));
  const route = upstreamIdFromPublicId(track.id);
  assert.ok(route);
  return route;
}

test('a signed result can fall back on another gateway instance when the primary fails', async () => {
  const attempted: string[] = [];
  const main: QobuzProvider = {
    async search() { return []; },
    async getStream(id) {
      attempted.push('main:' + id);
      throw new Error('upstream down');
    },
  };
  const other: QobuzProvider = {
    async search() {
      return [
        { ...original, title: 'One Kiss (Live)', upstreamId: 'live' },
        { ...original, title: 'One Kiss', artist: 'Different Artist', upstreamId: 'cover' },
        { ...original, title: 'One Kiss', duration: 30, upstreamId: 'preview' },
        { ...original, title: 'One Kiss', artist: 'Calvin Harris', upstreamId: 'other-id' },
      ];
    },
    async getStream(id) {
      attempted.push('other:' + id);
      return flac;
    },
  };
  const stream = await resolvePlayback(publicRoute(), 'LOSSLESS', 'auto', [
    { id: 'main', provider: main }, { id: 'other', provider: other },
  ], active);
  assert.equal(stream?.url, flac.url);
  assert.deepEqual(attempted, ['main:main-id', 'other:other-id']);
});

test('an older track ID still uses its original provider without searching', async () => {
  const primary: QobuzProvider = {
    async search() { assert.fail('search was unnecessary'); },
    async getStream(id) {
      assert.equal(id, 'main-id');
      return flac;
    },
  };
  const route = upstreamIdFromPublicId(normalizeTrack(original).id);
  assert.ok(route);
  const stream = await resolvePlayback(route, 'LOSSLESS', 'auto', [{ id: 'main', provider: primary }], active);
  assert.equal(stream?.url, flac.url);
});

test('a slow primary can be overtaken without changing the requested quality', async () => {
  const primary: QobuzProvider = {
    async search() { return []; },
    async getStream() { return new Promise(() => {}); },
  };
  const alternate: QobuzProvider = {
    async search() { return [{ ...original, upstreamId: 'alternate-id' }]; },
    async getStream(id, quality) {
      assert.equal(id, 'alternate-id');
      assert.equal(quality, 'LOSSLESS');
      return flac;
    },
  };
  const stream = await resolvePlayback(publicRoute(), 'LOSSLESS', 'auto', [
    { id: 'main', provider: primary }, { id: 'alternate', provider: alternate },
  ], active);
  assert.equal(stream?.url, flac.url);
});

test('lossless fallback rejects a lossy response', async () => {
  const alternate: QobuzProvider = {
    async search() { return [{ ...original, upstreamId: 'other-id' }]; },
    async getStream() { return { url: 'https://audio.example/one-kiss.mp3', format: 'mp3' }; },
  };
  const stream = await resolvePlayback(publicRoute(), 'LOSSLESS', 'auto', [
    { id: 'other', provider: alternate },
  ], active);
  assert.equal(stream, null);
});

test('identical concurrent requests share work without retaining a resolved URL', async () => {
  const requests = new InFlight<number>();
  let calls = 0;
  const resolve = async () => ++calls;
  assert.deepEqual(await Promise.all([requests.run('same', resolve), requests.run('same', resolve)]), [1, 1]);
  assert.equal(await requests.run('same', resolve), 2);
});
