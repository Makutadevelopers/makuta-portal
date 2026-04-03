import { createContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { User, LoginResponse } from '../types/user';
import { setApiToken } from '../api/client';

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
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const setAuth = useCallback((data: LoginResponse) => {
    setUser(data.user);
    setToken(data.token);
    setApiToken(data.token);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setApiToken(null);
  }, []);

  const value = useMemo(
    () => ({ user, token, setAuth, logout, isAuthenticated: !!token }),
    [user, token, setAuth, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
