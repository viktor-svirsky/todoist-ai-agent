import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import {
  uint8ToBase64,
  verifyHmac,
  encrypt,
  decrypt,
  encryptIfPresent,
  decryptIfPresent,
  _resetKeyCache,
  _resetHmacKeyCache,
  signOAuthState,
  verifyOAuthState,
} from "../_shared/crypto.ts";

Deno.test("uint8ToBase64: encodes empty array", () => {
  assertEquals(uint8ToBase64(new Uint8Array([])), "");
});

Deno.test("uint8ToBase64: encodes known bytes", () => {
  // "hello" in base64 = "aGVsbG8="
  const bytes = new TextEncoder().encode("hello");
  assertEquals(uint8ToBase64(bytes), "aGVsbG8=");
});

Deno.test("verifyHmac: returns true for valid signature", async () => {
  const secret = "test-secret";
  const body = '{"event":"test"}';

  // Compute expected signature
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const validSignature = btoa(String.fromCharCode(...new Uint8Array(sig)));

  assertEquals(await verifyHmac(secret, body, validSignature), true);
});

Deno.test("verifyHmac: returns false for invalid signature", async () => {
  _resetHmacKeyCache();
  assertEquals(
    await verifyHmac("secret", '{"event":"test"}', "invalid-signature"),
    false
  );
});

Deno.test("verifyHmac: returns false for different-length signature (constant-time)", async () => {
  _resetHmacKeyCache();
  assertEquals(await verifyHmac("secret", '{"event":"test"}', "short"), false);
  assertEquals(await verifyHmac("secret", '{"event":"test"}', ""), false);
  assertEquals(await verifyHmac("secret", '{"event":"test"}', "a".repeat(100)), false);
});

Deno.test("verifyHmac: returns false for tampered body", async () => {
  const secret = "test-secret";
  const originalBody = '{"event":"test"}';

  // Compute signature for original body
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(originalBody));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));

  // Verify with tampered body
  assertEquals(
    await verifyHmac(secret, '{"event":"tampered"}', signature),
    false
  );
});

Deno.test("verifyHmac: returns false for wrong secret", async () => {
  const body = '{"event":"test"}';

  // Compute signature with one secret
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode("secret-1"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));

  // Verify with different secret
  assertEquals(await verifyHmac("secret-2", body, signature), false);
});

// ---------------------------------------------------------------------------
// AES-256-GCM encryption / decryption
// ---------------------------------------------------------------------------

// Fixed test key: 32 random bytes, base64-encoded
const TEST_KEY = btoa(
  String.fromCharCode(
    ...[
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
    ]
  )
);

function withTestKey(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    _resetKeyCache();
    Deno.env.set("ENCRYPTION_KEY", TEST_KEY);
    try {
      await fn();
    } finally {
      _resetKeyCache();
      Deno.env.delete("ENCRYPTION_KEY");
    }
  };
}

Deno.test(
  "encrypt/decrypt: round-trip preserves plaintext",
  withTestKey(async () => {
    const plaintext = "my-secret-todoist-token-abc123";
    const ciphertext = await encrypt(plaintext);
    const result = await decrypt(ciphertext);
    assertEquals(result, plaintext);
  })
);

Deno.test(
  "encrypt: produces different ciphertext each call (random IV)",
  withTestKey(async () => {
    const plaintext = "same-input";
    const a = await encrypt(plaintext);
    const b = await encrypt(plaintext);
    assertNotEquals(a, b);
    // Both still decrypt to the same value
    assertEquals(await decrypt(a), plaintext);
    assertEquals(await decrypt(b), plaintext);
  })
);

Deno.test(
  "decrypt: fails on tampered ciphertext",
  withTestKey(async () => {
    const ciphertext = await encrypt("secret");
    // Flip a character in the middle of the base64 string
    const tampered =
      ciphertext.slice(0, 20) +
      (ciphertext[20] === "A" ? "B" : "A") +
      ciphertext.slice(21);
    await assertRejects(() => decrypt(tampered));
  })
);

Deno.test(
  "decrypt: fails with wrong key",
  withTestKey(async () => {
    const ciphertext = await encrypt("secret");

    // Switch to a different key
    _resetKeyCache();
    const otherKey = btoa(
      String.fromCharCode(
        ...[
          99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83,
          82, 81, 80, 79, 78, 77, 76, 75, 74, 73, 72, 71, 70, 69, 68,
        ]
      )
    );
    Deno.env.set("ENCRYPTION_KEY", otherKey);

    await assertRejects(() => decrypt(ciphertext));
  })
);

Deno.test(
  "encryptIfPresent/decryptIfPresent: null passthrough",
  withTestKey(async () => {
    assertEquals(await encryptIfPresent(null), null);
    assertEquals(await decryptIfPresent(null), null);
  })
);

Deno.test(
  "encryptIfPresent/decryptIfPresent: round-trip non-null",
  withTestKey(async () => {
    const encrypted = await encryptIfPresent("api-key-123");
    assertNotEquals(encrypted, "api-key-123");
    assertEquals(await decryptIfPresent(encrypted), "api-key-123");
  })
);

Deno.test("getEncryptionKey: throws descriptive error when ENCRYPTION_KEY missing", async () => {
  _resetKeyCache();
  Deno.env.delete("ENCRYPTION_KEY");
  await assertRejects(
    () => encrypt("test"),
    Error,
    "ENCRYPTION_KEY environment variable is not set"
  );
});

// ---------------------------------------------------------------------------
// OAuth state signing / verification
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-oauth-secret";

Deno.test("signOAuthState: produces nonce.timestamp.signature format", async () => {
  const state = await signOAuthState(TEST_SECRET);
  const parts = state.split(".");
  assertEquals(parts.length, 3);
  // First part is a UUID
  assertEquals(/^[0-9a-f-]{36}$/.test(parts[0]), true);
  // Second part is a unix timestamp
  assertEquals(Number.isInteger(parseInt(parts[1], 10)), true);
  // Third part is a non-empty base64 signature
  assertEquals(parts[2].length > 0, true);
});

Deno.test("verifyOAuthState: accepts valid state", async () => {
  const state = await signOAuthState(TEST_SECRET);
  assertEquals(await verifyOAuthState(TEST_SECRET, state), true);
});

Deno.test("verifyOAuthState: rejects state signed with wrong secret", async () => {
  const state = await signOAuthState(TEST_SECRET);
  assertEquals(await verifyOAuthState("wrong-secret", state), false);
});

Deno.test("verifyOAuthState: rejects tampered nonce", async () => {
  const state = await signOAuthState(TEST_SECRET);
  const parts = state.split(".");
  parts[0] = "00000000-0000-0000-0000-000000000000";
  assertEquals(await verifyOAuthState(TEST_SECRET, parts.join(".")), false);
});

Deno.test("verifyOAuthState: rejects tampered timestamp", async () => {
  const state = await signOAuthState(TEST_SECRET);
  const parts = state.split(".");
  parts[1] = "0";
  assertEquals(await verifyOAuthState(TEST_SECRET, parts.join(".")), false);
});

Deno.test("verifyOAuthState: rejects expired state", async () => {
  // Craft a state with a timestamp 601 seconds in the past
  const nonce = crypto.randomUUID();
  const oldTs = Math.floor(Date.now() / 1000) - 601;
  const payload = `${nonce}.${oldTs}`;
  // Sign it correctly — it should still be rejected due to age
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(TEST_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));
  const state = `${payload}.${signature}`;

  assertEquals(await verifyOAuthState(TEST_SECRET, state), false);
});

Deno.test("verifyOAuthState: rejects malformed state", async () => {
  assertEquals(await verifyOAuthState(TEST_SECRET, ""), false);
  assertEquals(await verifyOAuthState(TEST_SECRET, "only-one-part"), false);
  assertEquals(await verifyOAuthState(TEST_SECRET, "two.parts"), false);
  assertEquals(await verifyOAuthState(TEST_SECRET, "a.not-a-number.c"), false);
});

Deno.test("signOAuthState: produces unique states", async () => {
  const a = await signOAuthState(TEST_SECRET);
  const b = await signOAuthState(TEST_SECRET);
  assertNotEquals(a, b);
});
