// ============================================================
// api.ts — клиент API с CSRF, refresh и обработкой ошибок
// Все запросы — same-origin, куки httpOnly.
// ============================================================

const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  skipRefresh?: boolean;
}

let refreshing: Promise<boolean> | null = null;

async function refreshToken(): Promise<boolean> {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const url = buildUrl(path, options.query);

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'X-Requested-With': 'fetch',
    ...options.headers,
  };

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body,
      credentials: 'include',
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, 'ABORTED', 'Запрос отменён');
    }
    throw new ApiError(0, 'NETWORK', 'Нет соединения с сервером');
  }

  // 401 → пробуем refresh один раз
  if (res.status === 401 && !options.skipRefresh) {
    const ok = await refreshToken();
    if (ok) {
      return request<T>(path, { ...options, skipRefresh: true });
    }
  }

  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');

  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `Ошибка ${res.status}`;
    let details: unknown;

    if (isJson) {
      try {
        const data = (await res.json()) as {
          error?: string;
          message?: string;
          details?: unknown;
        };
        code = data.error ?? code;
        message = data.message ?? message;
        details = data.details;
      } catch {
        // игнорируем
      }
    }

    throw new ApiError(res.status, code, message, details);
  }

  if (res.status === 204) return undefined as T;

  if (isJson) return (await res.json()) as T;

  return (await res.text()) as unknown as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}