import { createContext, useState, useCallback, useMemo, useEffect, ReactNode } from 'react';
import { User, LoginResponse } from '../types/user';
import { setApiToken, setUnauthorizedHandler } from '../api/client';

interface AuthState {
  user: User | null;
  token: string | null;
  setAuth: (data: LoginResponse) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  token: null,
  setAuth: () => {},
  logout: () => {},
  isAuthenticated: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('makuta_user');
    return saved ? JSON.parse(saved) as User : null;
  });
  const [token, setToken] = useState<string | null>(() => {
    const saved = localStorage.getItem('makuta_token');
    if (saved) setApiToken(saved);
    return saved;
  });

  const setAuth = useCallback((data: LoginResponse) => {
    setUser(data.user);
    setToken(data.token);
    setApiToken(data.token);
    localStorage.setItem('makuta_token', data.token);
    localStorage.setItem('makuta_user', JSON.stringify(data.user));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setApiToken(null);
    localStorage.removeItem('makuta_token');
    localStorage.removeItem('makuta_user');
  }, []);

  // H6: Auto-logout on any 401 from the API (token expired or invalidated)
  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout();
      // Give the toast/error a moment to render before the login page takes over
      if (typeof window !== 'undefined') {
        window.alert('Your session has expired. Please log in again.');
      }
    });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const value = useMemo(
    () => ({ user, token, setAuth, logout, isAuthenticated: !!token }),
    [user, token, setAuth, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
