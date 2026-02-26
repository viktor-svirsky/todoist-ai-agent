import { supabase } from "../lib/supabase";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Landing() {
  const navigate = useNavigate();
  const [error] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("error") ? "Authentication failed. Please try again." : null;
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/settings");
    });
  }, [navigate]);

  const handleConnect = () => {
    const clientId = import.meta.env.VITE_TODOIST_CLIENT_ID;
    const state = crypto.randomUUID();
    sessionStorage.setItem("oauth_state", state);

    const params = new URLSearchParams({
      client_id: clientId,
      scope: "data:read_write",
      state,
    });

    window.location.href = `https://todoist.com/oauth/authorize?${params}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Todoist AI Agent</h1>
          <p className="mt-3 text-gray-600">
            An AI assistant that lives in your Todoist. Mention your trigger word
            in any comment and get an instant AI response.
          </p>
        </div>

        <div className="space-y-4 text-left text-sm text-gray-600">
          <div className="flex gap-3">
            <span className="text-lg">💬</span>
            <p>Comment <code className="bg-gray-200 px-1 rounded">@ai</code> on any task to get help</p>
          </div>
          <div className="flex gap-3">
            <span className="text-lg">🔍</span>
            <p>Web search included for current information</p>
          </div>
          <div className="flex gap-3">
            <span className="text-lg">🔑</span>
            <p>Bring your own AI key or use the shared default</p>
          </div>
        </div>

        {error && (
          <p className="text-red-600 text-sm">{error}</p>
        )}

        <button
          onClick={handleConnect}
          className="w-full py-3 px-4 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg transition-colors"
        >
          Connect Todoist
        </button>
      </div>
    </div>
  );
}
