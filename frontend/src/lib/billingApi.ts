import { supabase } from "./supabase";

async function authedPost(path: string): Promise<{ url: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${path}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return (await res.json()) as { url: string };
}

export const startCheckout = () => authedPost("stripe-checkout");
export const openBillingPortal = () => authedPost("stripe-portal");
