import React, { createContext, useContext, useState, useCallback } from 'react';
import apiClient from '../utils/apiClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('domus_user');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('domus_token'));

  const login = useCallback(async (email, password) => {
    const res = await apiClient.post('/auth/login', { email, password });
    const { token: t, user: u } = res.data;
    localStorage.setItem('domus_token', t);
    localStorage.setItem('domus_user', JSON.stringify(u));
    setToken(t);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('domus_token');
    localStorage.removeItem('domus_user');
    setToken(null);
    setUser(null);
  }, []);

  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAdmin, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
