import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

interface UserSettings {
  trigger_word: string;
  custom_ai_base_url: string | null;
  custom_ai_model: string | null;
  has_custom_ai_key: boolean;
  has_custom_brave_key: boolean;
  max_messages: number;
}

export default function Settings() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [triggerWord, setTriggerWord] = useState("@ai");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [braveKey, setBraveKey] = useState("");

  async function loadSettings(token: string) {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/settings`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setTriggerWord(data.trigger_word);
        setAiBaseUrl(data.custom_ai_base_url || "");
        setAiModel(data.custom_ai_model || "");
      } else {
        setError("Failed to load settings.");
      }
    } catch {
      setError("Network error. Please check your connection and refresh.");
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate("/");
        return;
      }
      loadSettings(session.access_token);
    });
  }, [navigate]);

  async function handleSave() {
    setSaving(true);
    setMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setSaving(false);
        return;
      }

      const updates: Record<string, string | null> = {
        trigger_word: triggerWord,
        custom_ai_base_url: aiBaseUrl || null,
        custom_ai_model: aiModel || null,
      };
      if (aiApiKey) updates.custom_ai_api_key = aiApiKey;
      if (braveKey) updates.custom_brave_key = braveKey;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/settings`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updates),
        }
      );

      setMessage(res.ok ? "Settings saved." : "Failed to save settings.");
      if (res.ok) {
        setAiApiKey("");
        setBraveKey("");
        loadSettings(session.access_token);
      }
    } catch {
      setMessage("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("This will delete your account and all data. Continue?")) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/settings`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.access_token}` },
        }
      );

      if (!res.ok) {
        setMessage("Failed to delete account. Please try again.");
        return;
      }

      await supabase.auth.signOut();
      navigate("/");
    } catch {
      setMessage("Network error. Please try again.");
    }
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-4">
      <div className="max-w-md w-full space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Trigger word</label>
            <input
              type="text"
              value={triggerWord}
              onChange={(e) => setTriggerWord(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="@ai"
            />
            <p className="mt-1 text-xs text-gray-500">
              The agent responds when this word appears in a comment.
            </p>
          </div>

          <hr />
          <p className="text-sm font-medium text-gray-700">AI Provider (optional)</p>
          <p className="text-xs text-gray-500">
            Leave empty to use the shared default. Any OpenAI-compatible provider works.
            Get a key from{" "}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">OpenAI</a>,{" "}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">OpenRouter</a>, or{" "}
            <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Groq</a>.
          </p>

          <div>
            <label className="block text-sm text-gray-600">Base URL</label>
            <input
              type="text"
              value={aiBaseUrl}
              onChange={(e) => setAiBaseUrl(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="https://api.openai.com/v1"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600">API Key</label>
            <input
              type="password"
              value={aiApiKey}
              onChange={(e) => setAiApiKey(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder={settings.has_custom_ai_key ? "••••••••  (key set)" : "sk-..."}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600">Model</label>
            <input
              type="text"
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="gpt-4o-mini"
            />
          </div>

          <hr />
          <p className="text-sm font-medium text-gray-700">Web Search (optional)</p>
          <p className="text-xs text-gray-500">
            Leave empty to use the shared default. Get a free key from{" "}
            <a href="https://brave.com/search/api/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Brave Search API</a>.
          </p>

          <div>
            <label className="block text-sm text-gray-600">Brave Search API Key</label>
            <input
              type="password"
              value={braveKey}
              onChange={(e) => setBraveKey(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder={settings.has_custom_brave_key ? "••••••••  (key set)" : "BSA..."}
            />
          </div>
        </div>

        {message && (
          <p className={`text-sm ${message.includes("Failed") ? "text-red-600" : "text-green-600"}`}>
            {message}
          </p>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>

        <button
          onClick={handleDisconnect}
          className="w-full py-2 px-4 bg-white border border-red-300 text-red-600 hover:bg-red-50 font-medium rounded-lg transition-colors"
        >
          Disconnect & Delete Account
        </button>

        <p className="text-center text-xs text-gray-400 pt-2">
          <a href="https://github.com/viktor-svirsky/todoist-ai-agent" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 hover:underline">GitHub</a>
          {" · "}
          Questions or issues? Open a{" "}
          <a href="https://github.com/viktor-svirsky/todoist-ai-agent/issues" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 hover:underline">GitHub issue</a>.
        </p>
      </div>
    </div>
  );
}
