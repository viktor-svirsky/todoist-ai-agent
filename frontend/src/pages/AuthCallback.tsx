import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // Verify that the user initiated the OAuth flow from this browser
    const pending = sessionStorage.getItem("oauth_pending");
    sessionStorage.removeItem("oauth_pending");

    if (!pending) {
      navigate("/?error=state_mismatch");
      return;
    }

    // Manually parse session from URL hash (detectSessionInUrl is disabled)
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (!accessToken || !refreshToken) {
      navigate("/?error=missing_session");
      return;
    }

    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) {
          navigate("/?error=session_failed");
        } else {
          navigate("/settings");
        }
      });

    const timeout = setTimeout(() => navigate("/?error=timeout"), 10_000);
    return () => clearTimeout(timeout);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4 sm:px-6">
      <div className="bg-white rounded-2xl shadow-xl p-8 sm:p-10">
        <p className="text-gray-500">Completing setup...</p>
      </div>
    </div>
  );
}
