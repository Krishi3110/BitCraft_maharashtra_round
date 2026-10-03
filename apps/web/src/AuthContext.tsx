import React, { useState } from 'react';
import { apiClient } from './api/client';
import { AuthContext } from './auth';

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
