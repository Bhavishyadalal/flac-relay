import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { streamResponse } from '../normalize.js';
import type { QobuzProvider, QobuzStream, QobuzTrack, Quality } from '../types.js';
import { UpstreamError } from './http.js';

const HintPrefix = 'recording:';
const PrimaryHeadStartMs = 1_500;
const StreamDeadlineMs = 6_000;
const SearchDeadlineMs = 5_500;

interface Recording {
  title: string;
  artist: string;
  duration: number;
  album?: string;
}

interface PlaybackSource {
  id: string;
  name?: string;
  provider: QobuzProvider;
}

interface Attempt {
  stream: QobuzStream | null;
  unavailable: boolean;
}

const noStream: Attempt = { stream: null, unavailable: false };

function recordingOf(track: QobuzTrack): Recording | undefined {
  const title = track.title.trim();
  const artist = track.artist?.trim();
  const duration = track.duration;
  if (!title || !artist || duration == null || !Number.isFinite(duration) || duration <= 0) return undefined;
  return { title, artist, duration: duration > 10_000 ? duration / 1000 : duration, album: track.album };
}

/** The signed public ID carries enough catalog information to find a fallback after a restart. */
export function withRecordingHint(track: QobuzTrack): QobuzTrack {
  const recording = recordingOf(track);
  if (!recording || track.atmos === true || track.audioModes?.some(mode => /atmos/i.test(mode))) return track;
  const upstreamId = HintPrefix + JSON.stringify([track.upstreamId, recording]);
  return Buffer.byteLength(upstreamId) <= 700 ? { ...track, upstreamId } : track;
}

function decodeRoute(trackId: string): { sourceId: string; id: string; recording?: Recording } | undefined {
  let route = trackId;
  let recording: Recording | undefined;
  if (route.startsWith(HintPrefix)) {
    try {
      const decoded: unknown = JSON.parse(route.slice(HintPrefix.length));
      if (!Array.isArray(decoded) || typeof decoded[0] !== 'string') return undefined;
      const hint = decoded[1] as Partial<Recording> | undefined;
      if (!hint || typeof hint.title !== 'string' || typeof hint.artist !== 'string' ||
          typeof hint.duration !== 'number' || !Number.isFinite(hint.duration) || hint.duration <= 0 ||
          (hint.album !== undefined && typeof hint.album !== 'string')) return undefined;
      route = decoded[0];
      recording = { title: hint.title, artist: hint.artist, duration: hint.duration, album: hint.album };
    } catch {
      return undefined;
    }
  }

  const separator = route.indexOf(':');
  if (separator <= 0 || separator === route.length - 1) return undefined;
  return { sourceId: route.slice(0, separator), id: route.slice(separator + 1), recording };
}

function words(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function titleKey(title: string): string {
  return words(title.replace(/[(\[]\s*(?:feat|ft|with)\.?\s+[^)\]]*[)\]]/gi, ' '));
}

function artistKeys(artist: string): string[] {
  return artist.split(/\s*(?:[,;&]|\s+(?:feat\.?|ft\.?|with|and)\s+)\s*/i).map(words).filter(Boolean);
}

const alternateEdition = /\b(?:live|remix|acoustic|instrumental|karaoke|tribute)\b/i;

function sameRecording(expected: Recording, track: QobuzTrack): boolean {
  const found = recordingOf(track);
  if (!found || Math.abs(found.duration - expected.duration) > 3 || track.atmos === true ||
      track.audioModes?.some(mode => /atmos/i.test(mode))) return false;

  const title = titleKey(expected.title);
  const artists = artistKeys(expected.artist);
  const expectedAlbum = expected.album ?? '';
  const foundAlbum = found.album ?? '';
  if ((alternateEdition.test(expectedAlbum) || alternateEdition.test(foundAlbum)) &&
      words(expectedAlbum) !== words(foundAlbum)) return false;
  return title.length > 0 && title === titleKey(found.title) &&
    artistKeys(found.artist).some(artist => artists.includes(artist));
}

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  if (timeoutMs <= 0) return undefined;
  const timer = new AbortController();
  try {
    return await Promise.race([
      promise,
      sleep(timeoutMs, undefined, { signal: timer.signal }),
    ]);
  } finally {
    timer.abort();
  }
}

export async function boundedSearch(search: Promise<QobuzTrack[]>): Promise<QobuzTrack[]> {
  const tracks = await within(search, SearchDeadlineMs);
  if (!tracks) throw new UpstreamError(504, 'Catalog sources timed out');
  return tracks;
}

function firstStream(attempts: Promise<Attempt>[]): Promise<Attempt> {
  return new Promise(resolve => {
    let pending = attempts.length;
    let unavailable = false;
    for (const attempt of attempts) {
      void attempt.then(result => {
        unavailable ||= result.unavailable;
        if (result.stream) resolve(result);
        else if (--pending === 0) resolve({ stream: null, unavailable });
      });
    }
  });
}

function isLossless(stream: QobuzStream): boolean {
  const format = stream.codec || stream.format || new URL(stream.url).pathname.split('.').pop() || '';
  return /^(?:audio\/)?(?:x-)?(?:flac|alac|wav|pcm)$/i.test(format.trim());
}

/** Resolve the primary first, then race verified matches from other catalogs under one deadline. */
export async function resolvePlayback(
  trackId: string,
  quality: Quality,
  atmos: string,
  sources: PlaybackSource[],
  isActive: (source: PlaybackSource) => boolean,
): Promise<QobuzStream | null> {
  const route = decodeRoute(trackId);
  if (!route) return null;
  const deadline = performance.now() + StreamDeadlineMs;

  async function open(source: PlaybackSource, id: string, alternate: boolean): Promise<Attempt> {
    if (!isActive(source)) return noStream;
    try {
      const stream = await source.provider.getStream(id, quality, atmos);
      if (!stream || !isActive(source)) return noStream;
      if (alternate && quality === 'LOSSLESS' && !isLossless(stream)) return noStream;
      return { stream: streamResponse(stream, quality), unavailable: false };
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 404) return noStream;
      return { stream: null, unavailable: true };
    }
  }

  const primarySource = sources.find(source => source.id === route.sourceId)
    ?? sources.find(source => source.name === route.sourceId);
  const primary = primarySource ? open(primarySource, route.id, false) : Promise.resolve(noStream);
  const recording = route.recording;
  const alternatives = recording ? sources.filter(source => source !== primarySource) : [];
  if (recording && alternatives.length > 0) {
    const quick = await within(primary, PrimaryHeadStartMs);
    if (quick?.stream) return quick.stream;
  }

  const attempts = [primary, ...alternatives.map(async source => {
    if (!recording || !isActive(source)) return noStream;
    try {
      const query = [artistKeys(recording.artist)[0], recording.title].filter(Boolean).join(' ');
      const tracks = await source.provider.search(query, quality, atmos);
      if (!isActive(source) || performance.now() >= deadline) return noStream;
      const track = tracks.find(candidate => sameRecording(recording, candidate));
      return track ? open(source, track.upstreamId, true) : noStream;
    } catch {
      return { stream: null, unavailable: true };
    }
  })];

  const result = await within(firstStream(attempts), deadline - performance.now());
  if (!result) throw new UpstreamError(504, 'Playback sources timed out');
  if (result.unavailable) throw new UpstreamError(503, 'Playback sources temporarily unavailable');
  return result.stream;
}
