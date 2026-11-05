export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
  }
}

/** fetch が接続の段階で失敗したことを表す(オフライン・DNS・接続拒否など)。
 *  TypeError を直接見ると、コードのバグ(実行時の TypeError)まで通信断に見えてしまうため、
 *  fetch の呼び出しだけをこの型に包み直して区別する */
export class NetworkError extends Error {
  constructor(public cause: unknown) {
    super("network error");
  }
}

async function fetchOrNetworkError(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (e) {
    throw new NetworkError(e);
  }
}

export type ApiErrorKind = "auth" | "network" | "server" | "other";

export interface DescribedApiError {
  kind: ApiErrorKind;
  /** 利用者に見せる文言(技術的な詳細は含めない) */
  message: string;
}

/**
 * 失敗の種類を、利用者が次に何をすればよいか分かる文言に変える。
 * ApiError(HTTP のエラー応答)と、fetch 自体の失敗(オフライン・接続不可)を区別する。
 */
export function describeApiError(err: unknown): DescribedApiError {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      return {
        kind: "auth",
        message: "Smarkyのログインが切れている可能性があります。Smarkyを開き直してから、もう一度お試しください。",
      };
    }
    if (err.status >= 500) {
      return {
        kind: "server",
        message: "Smarky側でエラーが起きました。時間をおいてから、もう一度お試しください。",
      };
    }
    return { kind: "other", message: `Smarkyからエラーが返されました(${err.status})。` };
  }
  if (err instanceof NetworkError) {
    return { kind: "network", message: "Smarkyと通信できませんでした。通信状況をご確認ください。" };
  }
  // それ以外は実装側の問題かもしれないので、原因の文言をそのまま残す
  return { kind: "other", message: err instanceof Error ? err.message : "不明なエラーが発生しました。" };
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetchOrNetworkError(path, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const body = await parseJsonSafe(res);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetchOrNetworkError(path, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const body = await parseJsonSafe(res);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
