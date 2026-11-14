export const AUTH_PATHS = ["/login", "/register", "/reset-password"];

export const isAuthPath = (path: string) => AUTH_PATHS.includes(path);

// Share links are opened by people without an account, and stay viewable when logged in.
export const isPublicPath = (path: string) =>
  isAuthPath(path) || path.startsWith("/share/note/");
