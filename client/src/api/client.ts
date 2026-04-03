// Shared fetch wrapper that attaches the JWT token.
// All API modules import apiFetch from here.

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

let tokenRef: string | null = null;

export function setApiToken(token: string | null) {
  tokenRef = token;
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

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `API error ${res.status}`);
  }

  return res.json();
}
