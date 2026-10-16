/**
 * Cloud backend configuration (Supabase project URL + publishable anon key).
 *
 * ONLY these two values ever reach the browser, and both are public by
 * design: the anon key is protected by Row Level Security server-side.
 * The Gemini key and any service-role key live exclusively in Supabase
 * secrets and never appear here, in the bundle, or in localStorage.
 *
 * Sources (first match wins):
 *   1. VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY build-time env vars
 *   2. localStorage `cnpc.cloud` = { url, anonKey } (runtime override; handy
 *      for pointing a dev build at a local/mock backend without rebuilding)
 */

const CLOUD_KEY = 'cnpc.cloud';

export interface CloudConfig {
  url: string;
  anonKey: string;
}

export interface CloudConfigSource {
  config: CloudConfig | null;
  source: 'env' | 'localStorage' | 'none';
  problem: string | null;
}

export function loadCloudConfig(): CloudConfigSource {
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (envUrl && envKey) {
    return { config: { url: envUrl.replace(/\/+$/, ''), anonKey: envKey }, source: 'env', problem: null };
  }
  if (envUrl || envKey) {
    return {
      config: null, source: 'env',
      problem: 'Partial cloud config: both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.',
    };
  }
  try {
    const raw = localStorage.getItem(CLOUD_KEY);
    if (raw) {
      const cfg = JSON.parse(raw);
      if (cfg?.url && cfg?.anonKey) {
        return { config: { url: String(cfg.url).replace(/\/+$/, ''), anonKey: String(cfg.anonKey) }, source: 'localStorage', problem: null };
      }
      return { config: null, source: 'localStorage', problem: '`cnpc.cloud` in localStorage must contain { url, anonKey }.' };
    }
  } catch {
    return { config: null, source: 'none', problem: '`cnpc.cloud` in localStorage is not valid JSON.' };
  }
  return { config: null, source: 'none', problem: null };
}
