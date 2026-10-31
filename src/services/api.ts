import type { ApiResponse } from "../../shared/api";

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}
export async function request<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<ApiResponse<T>> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "zhu-jia-web",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json: unknown = await response.json().catch(() => {
    throw new Error("服务暂时不可用，请稍后重试");
  });
  if (typeof json !== "object" || json === null)
    throw new Error("服务返回格式不正确，请稍后重试");
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    if (response.status === 404 && path.startsWith("/families/"))
      window.dispatchEvent(new Event("workspace-unavailable"));
    const error = "error" in json ? json.error : undefined;
    const fields = typeof error === "object" && error !== null ? error : {};
    throw new HttpError(
      "message" in fields && typeof fields.message === "string"
        ? fields.message
        : "请求失败",
      response.status,
      "code" in fields && typeof fields.code === "string" ? fields.code : undefined,
    );
  }
  if (!("data" in json)) throw new Error("服务返回格式不正确，请稍后重试");
  return json as ApiResponse<T>;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}
