import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-600">Completing setup...</p>
    </div>
  );
}
