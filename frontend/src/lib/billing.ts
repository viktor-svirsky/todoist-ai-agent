import { supabase } from "./supabase";

const BASE = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
  : "/functions/v1";

export async function startCheckout(): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token ?? "";
  const resp = await fetch(`${BASE}/stripe-checkout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!resp.ok) throw new Error(`checkout_${resp.status}`);
  const { url } = (await resp.json()) as { url: string };
  window.location.assign(url);
}

export async function openPortal(): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token ?? "";
  const resp = await fetch(`${BASE}/stripe-portal`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`portal_${resp.status}`);
  const { url } = (await resp.json()) as { url: string };
  window.location.assign(url);
}
