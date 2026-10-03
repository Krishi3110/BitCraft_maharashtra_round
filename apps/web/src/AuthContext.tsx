import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiClient } from '../api/client';

interface AuthContextType {
  isAuthenticated: boolean;
  isInitializing: boolean;
  login: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  const login = async () => {
    setIsInitializing(true);
    try {
      await apiClient.initSession();
      setIsAuthenticated(true);
    } catch (err) {
      console.error("Failed to initialize session", err);
    } finally {
      setIsInitializing(false);
    }
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isInitializing, login }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
