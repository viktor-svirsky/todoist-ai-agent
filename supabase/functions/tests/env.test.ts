import { assertThrows } from "@std/assert";
import { validateEnv, validateEncryptionKey } from "../_shared/env.ts";

// ---------------------------------------------------------------------------
// validateEnv
// ---------------------------------------------------------------------------

Deno.test("validateEnv: passes when all vars are set", () => {
  Deno.env.set("TEST_VAR_A", "value-a");
  Deno.env.set("TEST_VAR_B", "value-b");
  try {
    validateEnv(["TEST_VAR_A", "TEST_VAR_B"]);
  } finally {
    Deno.env.delete("TEST_VAR_A");
    Deno.env.delete("TEST_VAR_B");
  }
});

Deno.test("validateEnv: throws when a var is missing", () => {
  Deno.env.set("TEST_VAR_A", "value-a");
  Deno.env.delete("TEST_VAR_MISSING");
  try {
    assertThrows(
      () => validateEnv(["TEST_VAR_A", "TEST_VAR_MISSING"]),
      Error,
      "TEST_VAR_MISSING"
    );
  } finally {
    Deno.env.delete("TEST_VAR_A");
  }
});

Deno.test("validateEnv: throws when a var is empty string", () => {
  Deno.env.set("TEST_VAR_EMPTY", "");
  try {
    assertThrows(
      () => validateEnv(["TEST_VAR_EMPTY"]),
      Error,
      "TEST_VAR_EMPTY"
    );
  } finally {
    Deno.env.delete("TEST_VAR_EMPTY");
  }
});

Deno.test("validateEnv: throws when a var is whitespace only", () => {
  Deno.env.set("TEST_VAR_WHITESPACE", "   ");
  try {
    assertThrows(
      () => validateEnv(["TEST_VAR_WHITESPACE"]),
      Error,
      "TEST_VAR_WHITESPACE"
    );
  } finally {
    Deno.env.delete("TEST_VAR_WHITESPACE");
  }
});

Deno.test("validateEnv: lists all missing vars in error message", () => {
  Deno.env.delete("MISSING_1");
  Deno.env.delete("MISSING_2");
  try {
    assertThrows(
      () => validateEnv(["MISSING_1", "MISSING_2"]),
      Error,
      "MISSING_1, MISSING_2"
    );
  } finally {
    // cleanup not needed for missing vars
  }
});

Deno.test("validateEnv: empty required list passes", () => {
  validateEnv([]);
});

// ---------------------------------------------------------------------------
// validateEncryptionKey
// ---------------------------------------------------------------------------

Deno.test("validateEncryptionKey: passes with valid 32-byte base64 key", () => {
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  Deno.env.set("ENCRYPTION_KEY", key);
  try {
    validateEncryptionKey();
  } finally {
    Deno.env.delete("ENCRYPTION_KEY");
  }
});

Deno.test("validateEncryptionKey: throws when ENCRYPTION_KEY is missing", () => {
  const original = Deno.env.get("ENCRYPTION_KEY");
  Deno.env.delete("ENCRYPTION_KEY");
  try {
    assertThrows(
      () => validateEncryptionKey(),
      Error,
      "ENCRYPTION_KEY environment variable is not set"
    );
  } finally {
    if (original) Deno.env.set("ENCRYPTION_KEY", original);
  }
});

Deno.test("validateEncryptionKey: throws when ENCRYPTION_KEY is empty", () => {
  Deno.env.set("ENCRYPTION_KEY", "");
  try {
    assertThrows(
      () => validateEncryptionKey(),
      Error,
      "ENCRYPTION_KEY environment variable is not set"
    );
  } finally {
    Deno.env.delete("ENCRYPTION_KEY");
  }
});

Deno.test("validateEncryptionKey: throws when key decodes to wrong length", () => {
  // 16 bytes instead of 32
  const shortKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  Deno.env.set("ENCRYPTION_KEY", shortKey);
  try {
    assertThrows(
      () => validateEncryptionKey(),
      Error,
      "must decode to exactly 32 bytes"
    );
  } finally {
    Deno.env.delete("ENCRYPTION_KEY");
  }
});

Deno.test("validateEncryptionKey: throws when key is invalid base64", () => {
  Deno.env.set("ENCRYPTION_KEY", "not-valid-base64!!!");
  try {
    assertThrows(
      () => validateEncryptionKey(),
      Error,
      "not valid base64"
    );
  } finally {
    Deno.env.delete("ENCRYPTION_KEY");
  }
});

Deno.test("validateEncryptionKey: throws when key decodes to 64 bytes", () => {
  // 64 bytes — too long
  const longKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(64))));
  Deno.env.set("ENCRYPTION_KEY", longKey);
  try {
    assertThrows(
      () => validateEncryptionKey(),
      Error,
      "must decode to exactly 32 bytes"
    );
  } finally {
    Deno.env.delete("ENCRYPTION_KEY");
  }
});
