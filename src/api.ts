export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
export async function request<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<{ data: T; meta?: any }> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "zhu-jia-web",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await response.json().catch(() => {
    throw new Error("服务暂时不可用，请稍后重试");
  });
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    if (response.status === 404 && path.startsWith("/families/"))
      window.dispatchEvent(new Event("workspace-unavailable"));
    throw new HttpError(
      json.error?.message || "请求失败",
      response.status,
      json.error?.code,
    );
  }
  return json;
}
