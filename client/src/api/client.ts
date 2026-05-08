// Shared fetch wrapper that attaches the JWT token.
// All API modules import apiFetch from here.

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

let tokenRef: string | null = null;
// Called when the API returns 401 (token expired / invalid) so the app can redirect to login.
let unauthorizedHandler: (() => void) | null = null;

export function setApiToken(token: string | null) {
  tokenRef = token;
}

export function getApiToken(): string | null {
  return tokenRef;
}

// Origin of the API server (no trailing /api) — used to build absolute URLs for
// resources like attachment downloads that are referenced directly by the browser
// (e.g. <img src=...>) rather than fetched through apiFetch. In production
// VITE_API_BASE_URL is the Render backend URL; in dev it falls back to '/api'
// (relative to the Vite dev server, which proxies /api to the local backend).
export function getApiOrigin(): string {
  return API_BASE.replace(/\/api\/?$/, '');
}

/** Register a callback that will run when any API call returns 401 Unauthorized. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
    'ngrok-skip-browser-warning': 'true',
  };

  if (tokenRef) {
    headers['Authorization'] = `Bearer ${tokenRef}`;
  }

  // Don't set Content-Type for FormData (browser sets boundary)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    // H6: any 401 means the session is dead — fire the global handler to log the user out.
    // We only fire this if we had a token (otherwise a login attempt would loop).
    if (tokenRef && unauthorizedHandler) {
      unauthorizedHandler();
    }
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || 'Session expired — please log in again');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `API error ${res.status}`);
  }

  return res.json();
}

/**
 * Authenticated file download. Uses fetch() (with the JWT in the Authorization
 * header) to pull the response as a blob, then triggers a save dialog from a
 * blob URL. This deliberately avoids anchor-tag navigation to /api/...,
 * because the PWA service worker's navigateFallback would otherwise intercept
 * the navigation and serve index.html — causing the page to "reload to home"
 * instead of downloading.
 *
 * @param path     API path including query string, e.g. "/export/invoices?format=csv&site=Nirvana"
 * @param fallbackFilename Used if the response has no Content-Disposition header.
 * @param openInTab If true, opens the blob in a new tab instead of saving (used for PDFs).
 */
export async function downloadAuthenticated(
  path: string,
  fallbackFilename: string,
  openInTab = false,
): Promise<void> {
  const headers: Record<string, string> = {
    'ngrok-skip-browser-warning': 'true',
  };
  if (tokenRef) headers['Authorization'] = `Bearer ${tokenRef}`;

  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (res.status === 401) {
    if (tokenRef && unauthorizedHandler) unauthorizedHandler();
    throw new Error('Session expired — please log in again');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Download failed: ${res.status}`);
  }

  // Honour Content-Disposition's filename if the server provided one.
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(cd);
  const filename = m ? decodeURIComponent(m[1].trim()) : fallbackFilename;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  if (openInTab) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  } else {
    a.download = filename;
  }
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke the URL after a tick so the browser has time to start the download/tab.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
