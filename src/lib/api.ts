let memToken: string | null = null;

export function setAuthToken(token: string | null): void {
  memToken = token;
}

export function getAuthToken(): string | null {
  return memToken;
}

export function triggerHaptic(pattern: number | number[] = 18): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignore on unsupported browsers
  }
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (memToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${memToken}`);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let parsed: Record<string, unknown> | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(
        res.ok
          ? 'Phản hồi từ máy chủ không đúng định dạng JSON.'
          : `Lỗi kết nối máy chủ (${res.status}). Vui lòng thử lại.`
      );
    }
  }

  if (!res.ok) {
    const errMsg = parsed && typeof parsed.error === 'string' ? parsed.error : `Yêu cầu thất bại (${res.status})`;
    throw new Error(errMsg);
  }

  return (parsed ?? {}) as T;
}
