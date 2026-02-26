import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        navigate("/settings");
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/settings");
    });

    const timeout = setTimeout(() => navigate("/?error=timeout"), 10_000);
    return () => clearTimeout(timeout);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-600">Completing setup...</p>
    </div>
  );
}
