import { assertEquals } from "jsr:@std/assert";
import { uint8ToBase64, verifyHmac } from "../_shared/crypto.ts";

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
  assertEquals(
    await verifyHmac("secret", '{"event":"test"}', "invalid-signature"),
    false
  );
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
