import { supabase } from "../lib/supabase";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Landing() {
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState(false);
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
    setConnecting(true);
    sessionStorage.setItem("oauth_pending", "true");
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    window.location.href = `${supabaseUrl}/functions/v1/auth-start`;
  };

  return (
    <main
      className="min-h-screen bg-gray-100 flex flex-col items-center justify-center px-4 sm:px-6"
      role="main"
      aria-labelledby="landing-heading"
    >
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl p-8 sm:p-10 space-y-8">
        <div className="text-center">
          <h1
            id="landing-heading"
            className="text-4xl sm:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-red-500 to-violet-600 bg-clip-text text-transparent"
          >
            Todoist AI Agent
          </h1>
          <p className="mt-4 text-gray-500 text-base leading-relaxed">
            An AI assistant that lives in your Todoist. Mention your trigger word
            in any comment and get an instant AI response.
          </p>
        </div>

        <ul className="space-y-3" aria-label="Features">
          <li className="flex items-center gap-4 p-3 rounded-xl bg-gray-50">
            <span className="text-xl shrink-0" aria-hidden="true">💬</span>
            <p className="text-sm text-gray-600">Comment <code className="bg-gray-200 px-1.5 py-0.5 rounded text-gray-800 font-mono text-xs">@ai</code> on any task to get help</p>
          </li>
          <li className="flex items-center gap-4 p-3 rounded-xl bg-gray-50">
            <span className="text-xl shrink-0" aria-hidden="true">🔍</span>
            <p className="text-sm text-gray-600">Web search included for current information</p>
          </li>
          <li className="flex items-center gap-4 p-3 rounded-xl bg-gray-50">
            <span className="text-xl shrink-0" aria-hidden="true">🔑</span>
            <p className="text-sm text-gray-600">Bring your own AI key or use the shared default</p>
          </li>
        </ul>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 text-red-600 text-sm text-center" role="alert">
            {error}
          </div>
        )}

        <button
          onClick={handleConnect}
          disabled={connecting}
          className="w-full py-3.5 px-4 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white font-semibold rounded-xl shadow-sm hover:shadow-md transition-all cursor-pointer disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
          aria-busy={connecting}
        >
          {connecting ? "Redirecting..." : "Connect Todoist"}
        </button>

        <p className="text-center text-xs text-gray-400">
          <a href="https://github.com/viktor-svirsky/todoist-ai-agent" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 transition-colors">GitHub</a>
          {" · "}
          Questions? Open a{" "}
          <a href="https://github.com/viktor-svirsky/todoist-ai-agent/issues" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 transition-colors">GitHub issue</a>.
        </p>
      </div>
    </main>
  );
}
