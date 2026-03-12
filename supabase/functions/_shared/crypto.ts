export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let _cachedKey: CryptoKey | null = null;

export async function getEncryptionKey(): Promise<CryptoKey> {
  if (_cachedKey) return _cachedKey;
  const b64 = Deno.env.get("ENCRYPTION_KEY");
  if (!b64) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is not set. " +
      'Generate one with: deno -e "console.log(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))"'
    );
  }
  const raw = base64ToUint8(b64);
  _cachedKey = await crypto.subtle.importKey(
    "raw",
    raw.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  return _cachedKey;
}

export function _resetKeyCache(): void {
  _cachedKey = null;
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded)
  );
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv);
  combined.set(ciphertext, iv.length);
  return uint8ToBase64(combined);
}

export async function decrypt(encoded: string): Promise<string> {
  const key = await getEncryptionKey();
  const combined = base64ToUint8(encoded);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

export async function encryptIfPresent(
  value: string | null
): Promise<string | null> {
  if (value === null || value === undefined) return null;
  return encrypt(value);
}

export async function decryptIfPresent(
  value: string | null
): Promise<string | null> {
  if (value === null || value === undefined) return null;
  return decrypt(value);
}

export async function verifyHmac(
  secret: string,
  rawBody: string,
  signatureHeader: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  if (computed.length !== signatureHeader.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// OAuth state signing — HMAC-based self-verifying state tokens
// Format: nonce.timestamp.signature
// ---------------------------------------------------------------------------

async function hmacSign(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function hmacEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function signOAuthState(secret: string): Promise<string> {
  const nonce = crypto.randomUUID();
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${nonce}.${ts}`;
  const signature = await hmacSign(secret, payload);
  return `${payload}.${signature}`;
}

export async function verifyOAuthState(
  secret: string,
  state: string,
  maxAgeSeconds = 600,
): Promise<boolean> {
  const parts = state.split(".");
  if (parts.length !== 3) return false;

  const [, tsStr, signature] = parts;
  const ts = parseInt(tsStr, 10);
  if (isNaN(ts)) return false;

  // Reject expired states
  const now = Math.floor(Date.now() / 1000);
  if (now - ts > maxAgeSeconds) return false;

  // Verify HMAC signature
  const payload = `${parts[0]}.${tsStr}`;
  const computed = await hmacSign(secret, payload);
  return hmacEqual(computed, signature);
}
