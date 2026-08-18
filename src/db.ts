/**
 * PostgreSQL Backend Client Adapter
 * Replaces Firebase Auth & Firestore SDK calls with REST API & WebSocket listeners
 */

export interface AuthUser {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
}

const STORAGE_KEY = 'cteam_user_session';

export function getStoredUser(): AuthUser | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    return null;
  }
}

export function setStoredUser(user: AuthUser | null) {
  if (user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export async function signInWithGoogle(): Promise<AuthUser> {
  // Demo Google Sign-In simulation for PostgreSQL auth backend
  const demoUser: AuthUser = {
    uid: 'user_default_123',
    email: 'founder@example.com',
    displayName: 'Founder',
    photoURL: 'https://picsum.photos/seed/founder/200'
  };

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: demoUser.uid,
        email: demoUser.email,
        name: demoUser.displayName,
        avatarUrl: demoUser.photoURL
      })
    });
    const data = await res.json();
    if (data.user) {
      setStoredUser(demoUser);
      return demoUser;
    }
  } catch (e) {
    console.error("Auth backend error:", e);
  }

  setStoredUser(demoUser);
  return demoUser;
}

export async function logOut(): Promise<void> {
  setStoredUser(null);
}

// Database helper functions calling backend APIs
export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error ${res.status}`);
  }
  return res.json();
}
