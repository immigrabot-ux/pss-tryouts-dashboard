/**
 * Lightweight admin auth. Compares a plaintext password against ADMIN_PASSWORD.
 * Used by API routes that read/mutate leads from the dashboard.
 *
 * Both sides are .trim()'d to forgive accidental whitespace from copy/paste.
 */
export function isAdminPassword(provided: string | null | undefined): boolean {
  const expected = (process.env.ADMIN_PASSWORD || "").trim();
  if (!expected) return false;
  const got = (provided || "").trim();
  if (!got) return false;
  if (got.length !== expected.length) return false;
  // constant-time-ish compare
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  }
  return mismatch === 0;
}

export function unauthorized() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
