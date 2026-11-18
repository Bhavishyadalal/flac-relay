// Polyfill WebSocket in Node.js environments if missing for Supabase client initialization
if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as any).WebSocket = class DummyWebSocket {};
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';
import type { Config } from './config.js';

export interface UserAddonRecord {
  id: string;
  user_id: string | null;
  email: string;
  addon_slug: string;
  device_fingerprint: string | null;
  hardware_fingerprint?: string | null;
  daily_limit: number;
  is_revoked: boolean;
  created_at: string;
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SUPABASE_TIMEOUT')), timeoutMs);
    promise.then(
      res => { clearTimeout(timer); resolve(res); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

function createTimeoutFetch(timeoutMs: number) {
  return (input: any, init?: any) => {
    let signal: AbortSignal;
    if (init?.signal && typeof (AbortSignal as any).any === 'function') {
      signal = (AbortSignal as any).any([init.signal, AbortSignal.timeout(timeoutMs)]);
    } else {
      signal = AbortSignal.timeout(timeoutMs);
    }
    return fetch(input, { ...init, signal });
  };
}

export class AddonDatabase {
  private client: SupabaseClient | null = null;
  private supabaseHealthy = true;
  private lastCircuitTrip = 0;
  private timeoutMs = 2000;
  private localAddons: Map<string, UserAddonRecord> = new Map();
  private localProviders: Map<string, any> = new Map([
    ['monochrome', { id: 'monochrome', name: 'Monochrome Lossless Core', type: 'built-in', base_url: 'https://tracks.monochrome.st', is_enabled: true, health_status: 'operational', created_at: new Date().toISOString() }],
    ['instable', { id: 'instable', name: 'Arcod Lossless Source', type: 'built-in', base_url: 'https://arcod.xyz', is_enabled: false, health_status: 'offline', created_at: new Date().toISOString() }],
  ]);

  constructor(private readonly config: Config) {
    const url = process.env.SUPABASE_URL ?? this.config.supabaseUrl;
    const key = process.env.SUPABASE_KEY ?? this.config.supabaseKey;
    this.timeoutMs = process.env.NODE_ENV === 'test' ? 600 : 2000;
    if (url && key && process.env.DISABLE_SUPABASE !== 'true') {
      try {
        this.client = createClient(url, key, {
          auth: { persistSession: false },
          global: {
            fetch: createTimeoutFetch(this.timeoutMs),
          },
        });
      } catch {
        this.client = null;
      }
    }
  }

  private async queryWithTimeout<T>(promise: PromiseLike<T>): Promise<T> {
    return withTimeout(promise, this.timeoutMs);
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  private isSupabaseAvailable(): boolean {
    if (!this.client) return false;
    if (!this.supabaseHealthy) {
      if (Date.now() - this.lastCircuitTrip < 60000) {
        return false; // Circuit open: skip dead Supabase
      }
    }
    return true;
  }

  private tripCircuit(): void {
    this.supabaseHealthy = false;
    this.lastCircuitTrip = Date.now();
  }

  private markHealthy(): void {
    this.supabaseHealthy = true;
  }

  // Anti-sybil device fingerprint hasher
  hashDeviceFingerprint(rawCookie: string, secret: string): string {
    return createHash('sha256').update(`${rawCookie}:${secret}`).digest('hex');
  }

  // Verify Supabase Auth JWT Token
  async verifyUser(token: string): Promise<{ id: string; email: string } | null> {
    if (!this.isSupabaseAvailable()) return null;
    try {
      const { data: { user }, error } = await this.queryWithTimeout(this.client!.auth.getUser(token));
      if (error || !user || !user.email) {
        if (error) this.tripCircuit();
        return null;
      }
      this.markHealthy();
      return { id: user.id, email: user.email };
    } catch {
      this.tripCircuit();
      return null;
    }
  }

  async getAddonBySlug(slug: string): Promise<UserAddonRecord | null> {
    if (this.isSupabaseAvailable()) {
      try {
        const { data, error } = await this.queryWithTimeout(
          this.client!
            .from('user_addons')
            .select('*')
            .eq('addon_slug', slug)
            .single()
        );
        if (!error && data) {
          this.markHealthy();
          const rec = data as UserAddonRecord;
          this.localAddons.set(rec.addon_slug, rec);
          return rec;
        }
        if (error && error.code !== 'PGRST116') {
          this.tripCircuit();
        }
      } catch {
        this.tripCircuit();
      }
    }
    return this.localAddons.get(slug) || null;
  }

  async getAddonByEmail(email: string): Promise<UserAddonRecord | null> {
    const norm = email.toLowerCase().trim();
    if (this.isSupabaseAvailable()) {
      try {
        const { data, error } = await this.queryWithTimeout(
          this.client!
            .from('user_addons')
            .select('*')
            .eq('email', norm)
            .single()
        );
        if (!error && data) {
          this.markHealthy();
          const rec = data as UserAddonRecord;
          this.localAddons.set(rec.addon_slug, rec);
          return rec;
        }
        if (error && error.code !== 'PGRST116') {
          this.tripCircuit();
        }
      } catch {
        this.tripCircuit();
      }
    }
    for (const addon of this.localAddons.values()) {
      if (addon.email.toLowerCase().trim() === norm) return addon;
    }
    return null;
  }

  async getAddonByDevice(deviceFingerprint: string): Promise<UserAddonRecord | null> {
    if (this.isSupabaseAvailable()) {
      try {
        const { data, error } = await this.queryWithTimeout(
          this.client!
            .from('user_addons')
            .select('*')
            .eq('device_fingerprint', deviceFingerprint)
            .limit(1)
        );
        if (!error && data && data.length > 0) {
          this.markHealthy();
          const rec = data[0] as UserAddonRecord;
          this.localAddons.set(rec.addon_slug, rec);
          return rec;
        }
        if (error) this.tripCircuit();
      } catch {
        this.tripCircuit();
      }
    }
    for (const addon of this.localAddons.values()) {
      if (addon.device_fingerprint === deviceFingerprint) return addon;
    }
    return null;
  }

  async getAddonByHardware(hardwareFingerprint: string): Promise<UserAddonRecord | null> {
    if (!hardwareFingerprint) return null;
    if (this.isSupabaseAvailable()) {
      try {
        const { data, error } = await this.queryWithTimeout(
          this.client!
            .from('user_addons')
            .select('*')
            .eq('hardware_fingerprint', hardwareFingerprint)
            .limit(1)
        );
        if (!error && data && data.length > 0) {
          this.markHealthy();
          const rec = data[0] as UserAddonRecord;
          this.localAddons.set(rec.addon_slug, rec);
          return rec;
        }
        if (error) this.tripCircuit();
      } catch {
        this.tripCircuit();
      }
    }
    for (const addon of this.localAddons.values()) {
      if (addon.hardware_fingerprint === hardwareFingerprint) return addon;
    }
    return null;
  }

  async claimAddon(params: {
    userId?: string;
    email: string;
    deviceFingerprint: string;
    hardwareFingerprint?: string;
    customSlug?: string;
  }): Promise<{ addon: UserAddonRecord; isNew: boolean }> {
    const normalizedEmail = params.email.toLowerCase().trim();

    // 1. Check if user already has an addon assigned
    const existing = await this.getAddonByEmail(normalizedEmail);
    if (existing) {
      if (params.hardwareFingerprint && !existing.hardware_fingerprint) {
        existing.hardware_fingerprint = params.hardwareFingerprint;
        if (this.isSupabaseAvailable()) {
          try {
            await this.queryWithTimeout(
              this.client!
                .from('user_addons')
                .update({ hardware_fingerprint: params.hardwareFingerprint })
                .eq('id', existing.id)
            );
          } catch {
            this.tripCircuit();
          }
        }
      }
      return { addon: existing, isNew: false };
    }

    // 2. Anti-Sybil Check 1: Cookie/Zombie tracker fingerprint check
    const deviceExisting = await this.getAddonByDevice(params.deviceFingerprint);
    if (deviceExisting && deviceExisting.email !== normalizedEmail) {
      throw new Error(
        `Device already registered to another account (${deviceExisting.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')}). Only 1 personal addon link is permitted per device/household to prevent abuse.`
      );
    }

    // 3. Anti-Sybil Check 2: Hardware/GPU/Canvas fingerprint check (survives cookie deletion & incognito)
    if (params.hardwareFingerprint) {
      const hwExisting = await this.getAddonByHardware(params.hardwareFingerprint);
      if (hwExisting && hwExisting.email !== normalizedEmail) {
        throw new Error(
          `Hardware signature already registered to another account (${hwExisting.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')}). Only 1 personal addon link is permitted per device to prevent abuse.`
        );
      }
    }

    // 4. Generate unique slug
    let baseSlug = (params.customSlug || `rz-${randomBytes(4).toString('hex')}`)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-');
    if (!baseSlug.startsWith('rz-')) baseSlug = `rz-${baseSlug}`;

    const insertPayload: any = {
      id: randomBytes(16).toString('hex'),
      user_id: params.userId ?? null,
      email: normalizedEmail,
      addon_slug: baseSlug,
      device_fingerprint: params.deviceFingerprint,
      daily_limit: 0, // Legacy Supabase column, unused for playback.
      is_revoked: false,
      created_at: new Date().toISOString(),
    };
    if (params.hardwareFingerprint) {
      insertPayload.hardware_fingerprint = params.hardwareFingerprint;
    }

    if (this.isSupabaseAvailable()) {
      try {
        const { data, error } = await this.queryWithTimeout(
          this.client!
            .from('user_addons')
            .insert(insertPayload)
            .select()
            .single()
        );

        if (!error && data) {
          this.markHealthy();
          const rec = data as UserAddonRecord;
          this.localAddons.set(rec.addon_slug, rec);
          return { addon: rec, isNew: true };
        }
        if (error) this.tripCircuit();
      } catch {
        this.tripCircuit();
      }
    }

    // Resilient fallback storage
    this.localAddons.set(baseSlug, insertPayload as UserAddonRecord);
    return { addon: insertPayload as UserAddonRecord, isNew: true };
  }

  async getAllUserAddons(options?: {
    search?: string;
    filter?: 'all' | 'active' | 'revoked';
    limit?: number;
    offset?: number;
  }): Promise<{ addons: UserAddonRecord[]; total: number }> {
    const limit = Math.min(options?.limit ?? 100, 500);
    const offset = options?.offset ?? 0;

    if (this.isSupabaseAvailable()) {
      try {
        let query = this.client!
          .from('user_addons')
          .select('*', { count: 'exact' });

        if (options?.filter === 'active') {
          query = query.eq('is_revoked', false);
        } else if (options?.filter === 'revoked') {
          query = query.eq('is_revoked', true);
        }

        if (options?.search) {
          const term = options.search.trim().toLowerCase();
          query = query.or(`email.ilike.%${term}%,addon_slug.ilike.%${term}%`);
        }

        const { data, error, count } = await this.queryWithTimeout(
          query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)
        );

        if (!error && data) {
          this.markHealthy();
          return { addons: data as UserAddonRecord[], total: count ?? data.length };
        }
        if (error) this.tripCircuit();
      } catch {
        this.tripCircuit();
      }
    }

    // Local in-memory fallback
    let list = Array.from(this.localAddons.values());
    if (options?.filter === 'active') list = list.filter(a => !a.is_revoked);
    if (options?.filter === 'revoked') list = list.filter(a => a.is_revoked);
    if (options?.search) {
      const term = options.search.trim().toLowerCase();
      list = list.filter(a => a.email.toLowerCase().includes(term) || a.addon_slug.toLowerCase().includes(term));
    }
    const total = list.length;
    const paginated = list.slice(offset, offset + limit);
    return { addons: paginated, total };
  }

  async setAddonRevocation(slug: string, isRevoked: boolean): Promise<boolean> {
    const local = this.localAddons.get(slug);
    if (local) local.is_revoked = isRevoked;
    if (this.isSupabaseAvailable()) {
      try {
        const { error } = await this.queryWithTimeout(
          this.client!
            .from('user_addons')
            .update({ is_revoked: isRevoked })
            .eq('addon_slug', slug)
        );
        if (!error) {
          this.markHealthy();
          return true;
        }
        this.tripCircuit();
      } catch {
        this.tripCircuit();
      }
    }
    return true;
  }

  async getProviderSettings(): Promise<any[]> {
    if (this.isSupabaseAvailable()) {
      try {
        const { data, error } = await this.queryWithTimeout(
          this.client!
            .from('provider_settings')
            .select('*')
            .order('created_at', { ascending: true })
        );
        if (!error && data && data.length > 0) {
          this.markHealthy();
          for (const p of data) this.localProviders.set(p.id, p);
          return data;
        }
        if (error) this.tripCircuit();
      } catch {
        this.tripCircuit();
      }
    }
    return Array.from(this.localProviders.values());
  }

  async setProviderEnabled(id: string, isEnabled: boolean): Promise<boolean> {
    const existing = this.localProviders.get(id);
    if (existing) existing.is_enabled = isEnabled;
    if (this.isSupabaseAvailable()) {
      try {
        const { error } = await this.queryWithTimeout(
          this.client!
            .from('provider_settings')
            .update({ is_enabled: isEnabled })
            .eq('id', id)
        );
        if (!error) {
          this.markHealthy();
          return true;
        }
        this.tripCircuit();
      } catch {
        this.tripCircuit();
      }
    }
    return true;
  }

  async saveProviderSetting(provider: {
    id: string;
    name: string;
    type: string;
    base_url: string;
    is_enabled: boolean;
    health_status: string;
    last_tested_at?: string;
  }): Promise<boolean> {
    this.localProviders.set(provider.id, provider);
    if (this.isSupabaseAvailable()) {
      try {
        const { error } = await this.queryWithTimeout(
          this.client!
            .from('provider_settings')
            .upsert(provider)
        );
        if (!error) {
          this.markHealthy();
          return true;
        }
        this.tripCircuit();
      } catch {
        this.tripCircuit();
      }
    }
    return true;
  }

  async deleteProviderSetting(id: string): Promise<boolean> {
    this.localProviders.delete(id);
    if (this.isSupabaseAvailable()) {
      try {
        const { error } = await this.queryWithTimeout(
          this.client!
            .from('provider_settings')
            .delete()
            .eq('id', id)
        );
        if (!error) {
          this.markHealthy();
          return true;
        }
        this.tripCircuit();
      } catch {
        this.tripCircuit();
      }
    }
    return true;
  }
}
