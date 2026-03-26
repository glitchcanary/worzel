// sb-auth.js — Supabase token management for the Fink client.
// Works with or without cookies enabled.

const SB_TOKEN_KEY = 'sb-token';

/** Read the stored Supabase access token (localStorage > cookie). */
export function getSbToken() {
  try {
    const stored = localStorage.getItem(SB_TOKEN_KEY);
    if (stored) return stored;
  } catch { /* localStorage blocked */ }

  // Fallback: cookie
  const match = document.cookie.match(/(?:^|;\s*)sb-token=([^;]+)/);
  return match ? match[1] : null;
}

/** Store the Supabase access token in localStorage + cookie (best-effort). */
export function setSbToken(token, maxAge = 3600) {
  try { localStorage.setItem(SB_TOKEN_KEY, token); } catch {}
  try { document.cookie = `${SB_TOKEN_KEY}=${token}; path=/; max-age=${maxAge}; SameSite=Lax`; } catch {}
}

/** Clear the stored token (logout). */
export function clearSbToken() {
  try { localStorage.removeItem(SB_TOKEN_KEY); } catch {}
  try { document.cookie = `${SB_TOKEN_KEY}=; path=/; max-age=0`; } catch {}
}

/**
 * On page load: if `sb-token` is in the URL query, capture it and strip it
 * from the visible URL to keep it out of logs, bookmarks, and referrers.
 */
export function captureTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get(SB_TOKEN_KEY);
  if (!token) return null;

  setSbToken(token);

  // Strip the token from the URL
  params.delete(SB_TOKEN_KEY);
  const qs = params.toString();
  const cleanUrl = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
  window.history.replaceState(null, '', cleanUrl);

  return token;
}

/**
 * Append the Supabase token to a WebSocket URL (as `sb-token` query param)
 * so the server can authenticate without cookies.
 */
export function appendSbTokenToWsUrl(wsUrl) {
  const token = getSbToken();
  if (!token) return wsUrl;
  const separator = wsUrl.includes('?') ? '&' : '?';
  return `${wsUrl}${separator}${SB_TOKEN_KEY}=${encodeURIComponent(token)}`;
}

// Auto-capture on load
captureTokenFromUrl();
