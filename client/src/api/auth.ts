import { LoginResponse } from '../types/user';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

export async function loginApi(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || 'Login failed');
  }

  return res.json();
}
