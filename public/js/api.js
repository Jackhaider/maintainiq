// Thin wrapper around fetch(): adds the JWT, parses JSON and turns error responses into exceptions.

const TOKEN_KEY = 'maintainiq.token';
const USER_KEY = 'maintainiq.user';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details || [];
  }
}

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  },
  save(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
  get isSupervisor() { return this.user?.role === 'supervisor'; },
};

/**
 * api('/machines', { method: 'POST', body: {...}, query: {status: 'down'} })
 * Resolves with the parsed JSON body; rejects with ApiError (or a network Error).
 */
export async function api(path, { method = 'GET', body, query } = {}) {
  const url = new URL(`/api${path}`, window.location.origin);
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session.token) headers.Authorization = `Bearer ${session.token}`;

  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Cannot reach the server. Check your connection and try again.');
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    // Expired or invalid session: send the user back to the login screen.
    if (res.status === 401 && path !== '/auth/login') {
      session.clear();
      window.dispatchEvent(new CustomEvent('session-expired'));
    }
    throw new ApiError(res.status, data);
  }
  return data;
}
