import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // Verify OAuth state to prevent CSRF
    const params = new URLSearchParams(window.location.search);
    const returnedState = params.get("state");
    const savedState = sessionStorage.getItem("oauth_state");
    sessionStorage.removeItem("oauth_state");

    if (!returnedState || returnedState !== savedState) {
      navigate("/?error=state_mismatch");
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
        navigate("/settings");
      }
    });

    const timeout = setTimeout(() => navigate("/?error=timeout"), 10_000);
    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4 sm:px-6">
      <div className="bg-white rounded-2xl shadow-xl p-8 sm:p-10">
        <p className="text-gray-500">Completing setup...</p>
      </div>
    </div>
  );
}
