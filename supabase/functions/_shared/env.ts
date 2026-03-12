/** Validate that required environment variables are set and non-empty.
 *  Throws immediately with all missing vars listed, rather than failing
 *  at runtime with confusing errors.
 */
export function validateEnv(required: string[]): void {
  const missing = required.filter((key) => {
    const value = Deno.env.get(key);
    return value === undefined || value.trim() === "";
  });
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}`
    );
  }
}

/** Validate that ENCRYPTION_KEY is present and decodes to exactly 32 bytes. */
export function validateEncryptionKey(): void {
  const b64 = Deno.env.get("ENCRYPTION_KEY");
  if (!b64 || b64.trim() === "") {
    throw new Error(
      "ENCRYPTION_KEY environment variable is not set. " +
      'Generate one with: deno -e "console.log(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))"'
    );
  }
  try {
    const binary = atob(b64);
    if (binary.length !== 32) {
      throw new Error(
        `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${binary.length}). ` +
        'Generate a valid key with: deno -e "console.log(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))"'
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("ENCRYPTION_KEY must decode")) {
      throw e;
    }
    throw new Error(
      "ENCRYPTION_KEY is not valid base64. " +
      'Generate a valid key with: deno -e "console.log(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))"'
    );
  }
}
