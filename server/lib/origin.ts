/** The browser entry point may be served directly or by a separate reverse proxy. */
export function readAppOrigin(value: string | undefined, production: boolean): string {
  if (!value && production) throw new Error("生产环境需要设置 APP_ORIGIN");
  const source = value || "http://localhost:5173";
  try {
    const url = new URL(source);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid origin");
    return url.origin;
  } catch {
    throw new Error("APP_ORIGIN 必须是完整的 HTTP(S) 来源，不能包含账号、路径或查询参数");
  }
}
