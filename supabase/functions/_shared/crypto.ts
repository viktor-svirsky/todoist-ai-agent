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

const _hmacKeyCache = new Map<string, CryptoKey>();

export function _resetHmacKeyCache(): void {
  _hmacKeyCache.clear();
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const cached = _hmacKeyCache.get(secret);
  if (cached) return cached;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  _hmacKeyCache.set(secret, key);
  return key;
}

export async function verifyHmac(
  secret: string,
  rawBody: string,
  signatureHeader: string
): Promise<boolean> {
  const key = await getHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  const maxLen = Math.max(computed.length, signatureHeader.length);
  let mismatch = computed.length ^ signatureHeader.length;
  for (let i = 0; i < maxLen; i++) {
    mismatch |= (computed.charCodeAt(i) || 0) ^ (signatureHeader.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// OAuth state signing — HMAC-based self-verifying state tokens
// Format: nonce.timestamp.signature
// ---------------------------------------------------------------------------

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await getHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export function hmacEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
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

  // Reject expired or future-dated states (allow 60s clock skew)
  const now = Math.floor(Date.now() / 1000);
  if (now - ts > maxAgeSeconds) return false;
  if (ts > now + 60) return false;

  // Verify HMAC signature
  const payload = `${parts[0]}.${tsStr}`;
  const computed = await hmacSign(secret, payload);
  return hmacEqual(computed, signature);
}
