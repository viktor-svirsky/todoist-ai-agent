import { assert } from "@std/assert";

const ROOT = new URL("../../../", import.meta.url).pathname;

Deno.test("release.yml: auto-merge step extracts PR number from JSON with jq", async () => {
  const yaml = await Deno.readTextFile(
    `${ROOT}.github/workflows/release.yml`,
  );
  // Must not pass raw output.pr directly as PR_NUMBER — it's a JSON object
  assert(
    !yaml.includes("PR_NUMBER: ${{ steps.release.outputs.pr }}"),
    "auto-merge must not use raw steps.release.outputs.pr as PR_NUMBER (it's JSON)",
  );
  // Must extract .number from JSON
  assert(
    yaml.includes("jq -r '.number'"),
    "auto-merge step must extract PR number from JSON with jq",
  );
});

Deno.test("README badge: version badge uses query-param format to avoid release-please mangling", async () => {
  const readme = await Deno.readTextFile(`${ROOT}README.md`);
  const versionBadgeLine = readme
    .split("\n")
    .find((line) => line.includes("x-release-please-version"));
  assert(versionBadgeLine, "README must have a line with x-release-please-version annotation");

  // Must NOT use path-segment format where color is hyphen-adjacent to version
  // e.g. /badge/version-1.0.0-blue — release-please treats "1.0.0-blue" as semver
  assert(
    !versionBadgeLine.includes("/badge/version-"),
    "version badge must not use /badge/version-X.Y.Z-color format (release-please mangles it)",
  );

  // Must use query-param format that isolates version from color
  assert(
    versionBadgeLine.includes("img.shields.io/static/v1?"),
    "version badge must use shields.io static/v1 query-param format",
  );

  // Color must be a separate query param, not adjacent to version
  assert(
    versionBadgeLine.includes("&color="),
    "version badge color must be a separate query parameter",
  );
});

Deno.test("README badge: version matches package.json", async () => {
  const pkg = JSON.parse(await Deno.readTextFile(`${ROOT}package.json`));
  const readme = await Deno.readTextFile(`${ROOT}README.md`);
  const versionBadgeLine = readme
    .split("\n")
    .find((line) => line.includes("x-release-please-version"));
  assert(versionBadgeLine, "README must have a version badge line");

  assert(
    versionBadgeLine.includes(pkg.version),
    `version badge must contain package.json version (${pkg.version})`,
  );
});

Deno.test("release-please-config.json: README.md is in extra-files", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(`${ROOT}release-please-config.json`),
  );
  const extraFiles: string[] = config.packages["."]["extra-files"];
  assert(
    extraFiles.includes("README.md"),
    "release-please must have README.md in extra-files for version badge updates",
  );
});
