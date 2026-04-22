export function csvEscape(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Neutralize spreadsheet formula injection (CVE-2014-3524 class). A leading
  // =, +, -, @, or tab/CR in Excel/Sheets starts a formula; prefix a single
  // quote so the cell is treated as text.
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvLine(parts: (string | null | undefined)[]): string {
  return parts.map(csvEscape).join(",") + "\n";
}
