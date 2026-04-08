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

/** Register a callback that will run when any API call returns 401 Unauthorized. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
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
