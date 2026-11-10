/** The machine code of a Supabase or PostgreSQL error, or "" without one. Error texts are never shown to members. */
export function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}
