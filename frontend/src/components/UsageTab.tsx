import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useUsage, type UsageData } from "../hooks/useUsage";
import { UsageBarChart } from "./UsageBarChart";

const CSV_BASE = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/settings/usage.csv`
  : "/functions/v1/settings/usage.csv";

function Live24hCard({ live }: { live: UsageData["live_24h"] }) {
  const { used, limit, next_slot_at } = live;
  return (
    <section
      data-testid="usage-live-24h"
      className="rounded-2xl bg-gray-50 p-6"
    >
      <h3 className="text-sm font-semibold text-gray-800">Last 24 hours</h3>
      <p className="mt-1 text-sm text-gray-600">
        {used ?? 0}
        {limit > 0 ? ` of ${limit}` : ""} AI messages
      </p>
      {next_slot_at && (
        <p className="mt-1 text-xs text-gray-500">
          Next slot at {new Date(next_slot_at).toLocaleString()}
        </p>
      )}
    </section>
  );
}

function DailyTable({ rows }: { rows: UsageData["daily"] }) {
  return (
    <table
      data-testid="usage-daily-table"
      className="mt-4 w-full text-xs text-left text-gray-600"
    >
      <thead>
        <tr className="text-gray-500">
          <th className="py-1">Day</th>
          <th className="py-1 text-right">Counted</th>
          <th className="py-1 text-right">Denied</th>
          <th className="py-1 text-right">Refunded</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.day_start} className="border-t border-gray-200">
            <td className="py-1">{r.day_start.slice(0, 10)}</td>
            <td className="py-1 text-right">{r.counted}</td>
            <td className="py-1 text-right">{r.denied}</td>
            <td className="py-1 text-right">{r.refunded}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SummaryCard({ s }: { s: UsageData["summary"] }) {
  return (
    <section
      data-testid="usage-summary"
      className="rounded-2xl bg-gray-50 p-6"
    >
      <h3 className="text-sm font-semibold text-gray-800">
        Last {s.days} days
      </h3>
      <dl className="mt-2 grid grid-cols-4 gap-3 text-xs text-gray-600">
        <div>
          <dt className="text-gray-500">Total</dt>
          <dd className="text-base font-semibold text-gray-900">{s.total}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Counted</dt>
          <dd className="text-base font-semibold text-gray-900">{s.counted}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Denied</dt>
          <dd className="text-base font-semibold text-gray-900">{s.denied}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Refunded</dt>
          <dd className="text-base font-semibold text-gray-900">{s.refunded}</dd>
        </div>
      </dl>
    </section>
  );
}

function ToolsCard({ tools }: { tools: UsageData["tools"] }) {
  if (tools === null) {
    return (
      <section
        data-testid="usage-tools-placeholder"
        className="rounded-2xl bg-gray-50 p-6 text-xs text-gray-500"
      >
        Tool breakdown requires sub-project C.
      </section>
    );
  }
  if (tools.length === 0) {
    return (
      <section
        data-testid="usage-tools-empty"
        className="rounded-2xl bg-gray-50 p-6 text-xs text-gray-500"
      >
        No tool calls yet.
      </section>
    );
  }
  return (
    <section
      data-testid="usage-tools"
      className="rounded-2xl bg-gray-50 p-6"
    >
      <h3 className="text-sm font-semibold text-gray-800">Tool breakdown</h3>
      <ul className="mt-2 text-xs text-gray-600 space-y-1">
        {tools.map((t) => (
          <li key={t.tool_name} className="flex justify-between">
            <span>{t.tool_name}</span>
            <span className="font-mono text-gray-900">{t.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExportButton() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setErr(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token ?? "";
      const resp = await fetch(`${CSV_BASE}?days=30`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `todoist-ai-usage-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      // Defer revocation: some browsers race and abort the download if the
      // blob URL is revoked synchronously after click().
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="py-2 px-4 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-100 text-gray-700 text-sm font-medium rounded-xl transition-colors cursor-pointer disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-500"
        aria-busy={busy}
      >
        {busy ? "Exporting…" : "Export CSV"}
      </button>
      {err && (
        <p className="mt-1 text-xs text-red-600" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}

export function UsageTab() {
  const { data, loading, error, refresh } = useUsage();

  if (loading) {
    return (
      <div
        data-testid="usage-tab-skeleton"
        role="status"
        aria-busy="true"
        className="animate-pulse space-y-4"
      >
        <div className="h-20 bg-gray-100 rounded-2xl" />
        <div className="h-40 bg-gray-100 rounded-2xl" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid="usage-tab-error"
        className="rounded-2xl bg-red-50 p-6 text-sm text-red-600 space-y-3"
      >
        <p role="alert">Failed to load usage: {error.message}</p>
        <button
          type="button"
          onClick={() => {
            void refresh();
          }}
          className="py-2 px-4 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-xl cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <Live24hCard live={data.live_24h} />
      <section className="rounded-2xl bg-gray-50 p-6">
        <h3 className="text-sm font-semibold text-gray-800">Last 7 days</h3>
        <div className="mt-2">
          <UsageBarChart data={data.daily} />
        </div>
        <DailyTable rows={data.daily} />
      </section>
      <SummaryCard s={data.summary} />
      <ToolsCard tools={data.tools} />
      <ExportButton />
    </div>
  );
}
