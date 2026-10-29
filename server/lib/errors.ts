export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (status: number, code: string, message: string): never => {
  throw new ApiError(status, code, message);
};

export function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === code
  );
}
