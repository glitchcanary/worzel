import type { FastifyRequest, FastifyReply } from 'fastify';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from '../../config/schema.js';
import { fetchProfile, type Profile } from '../../fink/profile.js';

declare module 'fastify' {
  interface FastifyRequest {
    supabaseUser?: unknown;
    finkProfile?: Profile;
  }
}

let supabaseClient: SupabaseClient | null = null;

/**
 * Get or create the Supabase admin client (uses anon key for token verification).
 */
function getSupabaseClient(config: SupabaseConfig): SupabaseClient | null {
  if (!config.url || !config.anonKey) return null;
  if (!supabaseClient) {
    supabaseClient = createClient(config.url, config.anonKey);
  }
  return supabaseClient;
}

/**
 * Check whether Supabase auth is configured and enabled.
 */
export function isSupabaseEnabled(config: SupabaseConfig): boolean {
  return Boolean(config.url && config.anonKey);
}

/**
 * Fastify preHandler that verifies the Supabase access token from the
 * Authorization header or `sb-token` cookie. Returns 401 if invalid.
 *
 * Skips verification if Supabase is not configured (pass-through).
 */
export function createSupabaseAuthHook(config: SupabaseConfig) {
  return async function supabaseAuthHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const client = getSupabaseClient(config);
    if (!client) return; // Supabase not configured — skip auth

    const authHeader = request.headers.authorization;
    let token: string | undefined;

    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else {
      // Fall back to cookie
      const cookies = parseCookies(request.headers.cookie ?? '');
      token = cookies['sb-token'];
    }

    if (!token) {
      reply.status(401).send({ error: 'unauthorized', message: 'Missing access token' });
      return;
    }

    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) {
      reply.status(401).send({ error: 'unauthorized', message: 'Invalid or expired token' });
      return;
    }

    // Attach user to request for downstream handlers
    request.supabaseUser = data.user;
    const profile = await fetchProfile(config, data.user.id);
    request.finkProfile = profile ?? undefined;
  };
}

/**
 * Verify a Supabase access token for WebSocket upgrade requests.
 * Checks (in order): query param `sb-token`, Authorization header, cookie.
 * Returns the user ID or null if invalid/unconfigured.
 */
export async function verifySupabaseWsToken(
  config: SupabaseConfig,
  url: string,
  cookieHeader?: string,
  authorizationHeader?: string,
): Promise<string | null> {
  const client = getSupabaseClient(config);
  if (!client) return null;

  try {
    const parsed = new URL(url, 'http://localhost');
    let token = parsed.searchParams.get('sb-token');

    // Fall back to Authorization header (for clients that set headers on WS)
    if (!token && authorizationHeader?.startsWith('Bearer ')) {
      token = authorizationHeader.slice(7);
    }

    // Fall back to cookie
    if (!token && cookieHeader) {
      const cookies = parseCookies(cookieHeader);
      token = cookies['sb-token'] ?? null;
    }

    if (!token) return null;

    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex < 0) continue;
    const key = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}
