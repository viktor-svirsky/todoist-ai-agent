import { assertEquals } from "@std/assert";
import { csvEscape, csvLine } from "../_shared/csv.ts";

function t(name: string, fn: () => void | Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

t("csvEscape: empty / null / undefined → empty string", () => {
  assertEquals(csvEscape(""), "");
  assertEquals(csvEscape(null), "");
  assertEquals(csvEscape(undefined), "");
});

t("csvEscape: plain value passes through", () => {
  assertEquals(csvEscape("hello"), "hello");
  assertEquals(csvEscape("2026-04-21T00:00:00Z"), "2026-04-21T00:00:00Z");
});

t("csvEscape: comma wraps in quotes", () => {
  assertEquals(csvEscape("a,b"), `"a,b"`);
});

t("csvEscape: double-quote is doubled and wrapped", () => {
  assertEquals(csvEscape(`he said "hi"`), `"he said ""hi"""`);
});

t("csvEscape: newline and CR wrap in quotes", () => {
  assertEquals(csvEscape("a\nb"), `"a\nb"`);
  assertEquals(csvEscape("a\r\nb"), `"a\r\nb"`);
});

t("csvEscape: neutralizes spreadsheet formula injection", () => {
  assertEquals(csvEscape("=SUM(A1:A9)"), "'=SUM(A1:A9)");
  assertEquals(csvEscape("+danger"), "'+danger");
  assertEquals(csvEscape("-5"), "'-5");
  assertEquals(csvEscape("@cmd"), "'@cmd");
  assertEquals(csvEscape("\tstarts-with-tab"), "'\tstarts-with-tab");
  // Inner special chars still OK.
  assertEquals(csvEscape("plain=value"), "plain=value");
});

t("csvLine: joins + terminates with \\n", () => {
  assertEquals(
    csvLine(["a", "b", "c"]),
    "a,b,c\n",
  );
});

t("csvLine: escapes per-field and keeps column count", () => {
  assertEquals(
    csvLine(["2026-04-21", "free", "true", null, `id,with,commas`]),
    `2026-04-21,free,true,,"id,with,commas"\n`,
  );
});
