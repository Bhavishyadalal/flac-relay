import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.js';
import type { AddonDatabase } from './db.js';
import type { RacingProvider, DynamicSource } from './providers/racing.js';
import { RemoteAddonProvider } from './providers/remote-addon.js';

export function generateAdminToken(config: Config): string {
  return createHmac('sha256', config.idSecret)
    .update(`admin_auth_session:${config.adminPassword}`)
    .digest('hex');
}

export function verifyAdminToken(token: string | undefined, config: Config): boolean {
  if (!token || !config.adminPassword) return false;
  const expected = generateAdminToken(config);
  try {
    return timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export function verifyAdminPassword(candidate: string | undefined, config: Config): boolean {
  if (!candidate || !config.adminPassword) return false;
  try {
    const candidateBuf = Buffer.from(candidate);
    const expectedBuf = Buffer.from(config.adminPassword);
    if (candidateBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(candidateBuf, expectedBuf);
  } catch {
    return false;
  }
}

export interface BenchmarkResult {
  ok: boolean;
  id?: string;
  name?: string;
  baseUrl?: string;
  latencyMs?: number;
  trackCount?: number;
  sampleTitle?: string;
  error?: string;
}

export async function benchmarkAndVerifyAddon(rawUrl: string, config: Config): Promise<BenchmarkResult> {
  let target = rawUrl.trim();
  if (!target) return { ok: false, error: 'Addon URL is required' };
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`;

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return { ok: false, error: 'Invalid URL format' };
  }

  // Base URL without manifest.json
  const basePath = parsed.pathname.replace(/\/manifest\.json$/i, '').replace(/\/+$/, '');
  const baseUrl = `${parsed.origin}${basePath}`;
  const manifestUrl = `${baseUrl}/manifest.json`;

  const startTime = Date.now();

  // 1. Manifest verification
  let manifestName = 'External Lossless Addon';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(manifestUrl, {
      headers: { accept: 'application/json', 'user-agent': 'FLAC-Relay-AddonTester/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return { ok: false, error: `Manifest returned HTTP ${res.status} ${res.statusText}` };
    const manifest: any = await res.json();
    if (!manifest || typeof manifest !== 'object') {
      return { ok: false, error: 'Manifest did not return a valid JSON object' };
    }
    if (manifest.name) manifestName = String(manifest.name);
  } catch (err: any) {
    return { ok: false, error: `Could not reach manifest.json: ${err?.message || err}` };
  }

  // 2. Search probe (benchmark known song)
  const probe = new RemoteAddonProvider(config, baseUrl);
  let tracks: any[] = [];
  try {
    tracks = await probe.search('Hotel California', 'LOSSLESS', 'auto');
    if (!tracks || tracks.length === 0) {
      tracks = await probe.search('Daft Punk', 'LOSSLESS', 'auto');
    }
  } catch (err: any) {
    return { ok: false, error: `Search probe failed: ${err?.message || err}` };
  }

  if (!tracks || tracks.length === 0) {
    return { ok: false, error: 'Benchmark search query returned 0 tracks from addon' };
  }

  const sampleTrack = tracks[0];
  const latencyMs = Date.now() - startTime;

  // 3. Stream resolution probe
  try {
    const stream = await probe.getStream(sampleTrack.upstreamId, 'LOSSLESS', 'auto');
    if (!stream || !stream.url || !/^https:\/\//i.test(stream.url)) {
      return { ok: false, error: 'Stream probe returned an invalid or non-HTTPS media URL' };
    }
  } catch (err: any) {
    return { ok: false, error: `Stream probe failed: ${err?.message || err}` };
  }

  // Generate clean slug ID from hostname and path
  const hostSlug = parsed.hostname.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const pathSlug = basePath ? basePath.replace(/[^a-z0-9]/gi, '_').toLowerCase() : '';
  const id = `ext_${hostSlug}${pathSlug ? '_' + pathSlug : ''}`.slice(0, 36);

  return {
    ok: true,
    id,
    name: manifestName,
    baseUrl,
    latencyMs,
    trackCount: tracks.length,
    sampleTitle: `${sampleTrack.title}${sampleTrack.artist ? ' - ' + sampleTrack.artist : ''}`,
  };
}

const adminPage = readFileSync(new URL('../web/admin.html', import.meta.url), 'utf8');

export function renderAdminHtml(): string {
  return adminPage;
}
