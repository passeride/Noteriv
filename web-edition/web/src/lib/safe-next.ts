/**
 * Where to go after signing in, from a `?next=` value. Only a path on this site is accepted: anything that could
 * leave it (`//host`, `/\host`, `https://…`, `javascript:`) falls back to the vault list.
 */
export function safeNext(value: string | null | undefined, fallback = "/vaults"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}
