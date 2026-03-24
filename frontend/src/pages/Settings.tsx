import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import PageFooter from "../components/PageFooter";

interface UserSettings {
  trigger_word: string;
  custom_ai_base_url: string | null;
  custom_ai_model: string | null;
  has_custom_ai_key: boolean;
  has_custom_brave_key: boolean;
  max_messages: number;
  custom_prompt: string | null;
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-gray-200 rounded-xl ${className}`}
      aria-hidden="true"
    />
  );
}

function SettingsSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading settings"
      aria-busy="true"
    >
      <div className="bg-gradient-to-b from-gray-50 to-white py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <SkeletonBlock className="h-10 w-40" />
        </div>
      </div>
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-4 py-3">
          <SkeletonBlock className="h-6 w-16" />
          <SkeletonBlock className="h-6 w-24" />
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        <div className="rounded-2xl bg-gray-50 p-6 space-y-4">
          <SkeletonBlock className="h-4 w-24" />
          <SkeletonBlock className="h-10 w-full" />
          <SkeletonBlock className="h-4 w-36" />
          <SkeletonBlock className="h-24 w-full" />
        </div>
        <SkeletonBlock className="h-12 w-full" />
      </div>
      <span className="sr-only">Loading settings...</span>
    </div>
  );
}

function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      cancelRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-desc"
      onClick={onCancel}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 sm:p-8 max-w-sm w-full space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-modal-title" className="text-lg font-bold text-gray-900">
          {title}
        </h2>
        <p id="confirm-modal-desc" className="text-sm text-gray-600">
          {message}
        </p>
        <div className="flex gap-3 justify-end pt-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="py-2 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-500"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="py-2 px-4 bg-red-600 hover:bg-red-700 text-white font-medium rounded-xl transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className: string;
  ariaLabel: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${className} pr-10`}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 rounded"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
            <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
            <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
          </svg>
        )}
      </button>
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const [triggerWord, setTriggerWord] = useState("@ai");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [braveKey, setBraveKey] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ valid: boolean; error?: string } | null>(null);
  const testAbortRef = useRef<AbortController | null>(null);

  const [activeTab, setActiveTab] = useState<"basic" | "advanced">("basic");

  function handleTabChange(tab: "basic" | "advanced") {
    setActiveTab(tab);
    if (tab === "basic") {
      setTestResult(null);
    }
  }

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
        setCustomPrompt(data.custom_prompt || "");
      } else if (res.status === 401) {
        await supabase.auth.signOut();
        navigate("/");
      } else if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10) || 60;
        setError(`Too many requests. Please try again in ${retryAfter} seconds.`);
      } else if (res.status === 403) {
        setError("Your account has been disabled. Please contact support.");
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
        custom_prompt: customPrompt || null,
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

      if (res.ok) {
        setMessage("Settings saved.");
        setAiApiKey("");
        setBraveKey("");
        await loadSettings(session.access_token);
      } else if (res.status === 401) {
        await supabase.auth.signOut();
        navigate("/");
        return;
      } else if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10) || 60;
        setMessage(`Too many requests. Please try again in ${retryAfter} seconds.`);
      } else if (res.status === 403) {
        setMessage("Your account has been disabled. Please contact support.");
      } else {
        setMessage("Failed to save settings.");
      }
    } catch {
      setMessage("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestKey() {
    // Abort any in-flight test request
    testAbortRef.current?.abort();
    const controller = new AbortController();
    testAbortRef.current = controller;

    setTesting(true);
    setTestResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setTestResult({ valid: false, error: "Session expired. Please sign in again." });
        setTesting(false);
        return;
      }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/settings`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            base_url: aiBaseUrl,
            api_key: aiApiKey,
            model: aiModel,
          }),
          signal: controller.signal,
        }
      );

      if (res.ok) {
        const data = await res.json();
        setTestResult(data);
      } else if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10) || 60;
        setTestResult({ valid: false, error: `Too many requests. Try again in ${retryAfter}s.` });
      } else if (res.status === 403) {
        setTestResult({ valid: false, error: "Account disabled." });
      } else {
        const data = await res.json().catch(() => ({}));
        setTestResult({ valid: false, error: data.error || "Validation request failed." });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setTestResult({ valid: false, error: "Network error." });
    } finally {
      if (!controller.signal.aborted) setTesting(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate("/");
  }

  async function handleDisconnect() {
    setShowDeleteModal(false);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/");
        return;
      }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/settings`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.access_token}` },
        }
      );

      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10) || 60;
          setMessage(`Too many requests. Please try again in ${retryAfter} seconds.`);
        } else if (res.status === 403) {
          setMessage("Your account has been disabled. Please contact support.");
        } else {
          setMessage("Failed to delete account. Please try again.");
        }
        return;
      }

      await supabase.auth.signOut();
      navigate("/");
    } catch {
      setMessage("Network error. Please try again.");
    }
  }

  async function handleResetAi() {
    testAbortRef.current?.abort();
    setTesting(false);
    setTestResult(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/settings`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ custom_ai_base_url: null, custom_ai_api_key: null, custom_ai_model: null }),
    });
    if (!res.ok) {
      setMessage("Failed to reset AI settings. Please try again.");
      return;
    }
    setAiBaseUrl("");
    setAiApiKey("");
    setAiModel("");
    await loadSettings(session.access_token);
  }

  async function handleResetBraveKey() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/settings`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ custom_brave_key: null }),
    });
    if (!res.ok) {
      setMessage("Failed to reset search key. Please try again.");
      return;
    }
    setBraveKey("");
    await loadSettings(session.access_token);
  }

  if (error) {
    return (
      <main
        className="min-h-screen bg-white flex items-center justify-center px-4 sm:px-6"
        role="main"
      >
        <div className="rounded-2xl bg-gray-50 p-8 sm:p-10 space-y-4 text-center max-w-md">
          <p className="text-red-600" role="alert">{error}</p>
          <button
            onClick={() => {
              setError(null);
              supabase.auth.getSession().then(({ data: { session } }) => {
                if (!session) {
                  navigate("/");
                  return;
                }
                loadSettings(session.access_token);
              });
            }}
            className="py-2 px-4 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!settings) {
    return <SettingsSkeleton />;
  }

  const inputClasses = "mt-1.5 w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500";
  const isSuccess = message === "Settings saved.";

  return (
    <main role="main" aria-labelledby="settings-heading">
      {/* Hero header */}
      <section className="bg-gradient-to-b from-gray-50 to-white py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <h1
            id="settings-heading"
            className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-red-500 to-violet-600 bg-clip-text text-transparent"
          >
            Settings
          </h1>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 rounded px-2 py-1"
            aria-label="Sign out"
          >
            Sign Out
          </button>
        </div>
      </section>

      {/* Tab bar */}
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus */}
          <div
            role="tablist"
            aria-label="Settings sections"
            className="flex gap-0"
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next = activeTab === "basic" ? "advanced" : "basic";
                handleTabChange(next);
                document.getElementById(`${next}-tab`)?.focus();
              }
            }}
          >
            <button
              role="tab"
              tabIndex={activeTab === "basic" ? 0 : -1}
              aria-selected={activeTab === "basic"}
              aria-controls="basic-panel"
              id="basic-tab"
              onClick={() => handleTabChange("basic")}
              className={`py-3 px-5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === "basic"
                  ? "border-red-500 text-red-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Basic
            </button>
            <button
              role="tab"
              tabIndex={activeTab === "advanced" ? 0 : -1}
              aria-selected={activeTab === "advanced"}
              aria-controls="advanced-panel"
              id="advanced-tab"
              onClick={() => handleTabChange("advanced")}
              className={`py-3 px-5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === "advanced"
                  ? "border-red-500 text-red-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Advanced
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        {/* Status message */}
        {message && (
          <div
            className={`p-3 rounded-xl text-sm text-center ${isSuccess ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"}`}
            role="status"
            aria-live="polite"
          >
            {message}
          </div>
        )}

        {/* Basic tab */}
        {activeTab === "basic" && (
          <div id="basic-panel" role="tabpanel" aria-labelledby="basic-tab" className="space-y-8">
            <div className="rounded-2xl bg-gray-50 p-6 space-y-6">
              <div>
                <label htmlFor="trigger-word" className="block text-sm font-medium text-gray-700">Trigger word</label>
                <input
                  id="trigger-word"
                  type="text"
                  value={triggerWord}
                  onChange={(e) => setTriggerWord(e.target.value)}
                  className={`${inputClasses} font-mono`}
                  placeholder="@ai"
                  aria-describedby="trigger-word-desc"
                />
                <p id="trigger-word-desc" className="mt-1.5 text-xs text-gray-500">
                  The agent responds when this word appears in a comment.
                </p>
              </div>

              <div>
                <label htmlFor="custom-prompt" className="block text-sm font-medium text-gray-700">Custom Instructions</label>
                <textarea
                  id="custom-prompt"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  className={`${inputClasses} resize-y min-h-[100px]`}
                  placeholder="e.g. I live in Berlin. Respond in German. Keep answers short and practical."
                  maxLength={2000}
                  rows={4}
                  aria-describedby="custom-prompt-desc custom-prompt-count"
                />
                <div className="mt-1.5 flex justify-between">
                  <p id="custom-prompt-desc" className="text-xs text-gray-500">
                    Personal context the AI will use when responding.
                  </p>
                  <p id="custom-prompt-count" className="text-xs text-gray-400" aria-live="polite">{customPrompt.length}/2000</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Advanced tab */}
        {activeTab === "advanced" && (
          <div id="advanced-panel" role="tabpanel" aria-labelledby="advanced-tab" className="space-y-8">
            <fieldset className="rounded-2xl bg-gray-50 p-6 space-y-4">
              <legend className="sr-only">AI Provider Settings</legend>
              <div>
                <p className="text-sm font-semibold text-gray-800">AI Provider</p>
                <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                  Optional. Supports Anthropic and any OpenAI-compatible provider.
                  Get a key from{" "}
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-red-500 hover:underline">Anthropic</a>,{" "}
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-red-500 hover:underline">OpenAI</a>,{" "}
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-red-500 hover:underline">OpenRouter</a>, or{" "}
                  <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="text-red-500 hover:underline">Groq</a>.
                </p>
              </div>

              <div>
                <label htmlFor="ai-base-url" className="block text-sm text-gray-600">Base URL</label>
                <input
                  id="ai-base-url"
                  type="text"
                  value={aiBaseUrl}
                  onChange={(e) => { setAiBaseUrl(e.target.value); setTestResult(null); testAbortRef.current?.abort(); }}
                  className={inputClasses}
                  placeholder="https://api.openai.com/v1"
                />
              </div>

              <div>
                <label htmlFor="ai-api-key" className="block text-sm text-gray-600">API Key</label>
                <PasswordInput
                  id="ai-api-key"
                  value={aiApiKey}
                  onChange={(v) => { setAiApiKey(v); setTestResult(null); testAbortRef.current?.abort(); }}
                  className={inputClasses}
                  placeholder={settings.has_custom_ai_key ? "••••••••  (key set)" : "sk-..."}
                  ariaLabel="AI provider API key"
                />
              </div>

              <div>
                <label htmlFor="ai-model" className="block text-sm text-gray-600">Model</label>
                <input
                  id="ai-model"
                  type="text"
                  value={aiModel}
                  onChange={(e) => { setAiModel(e.target.value); setTestResult(null); testAbortRef.current?.abort(); }}
                  className={inputClasses}
                  placeholder="gpt-4o-mini"
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {aiBaseUrl && aiApiKey && aiModel && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={handleTestKey}
                      disabled={testing}
                      className="py-2 px-4 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-100 text-gray-700 text-sm font-medium rounded-xl transition-colors cursor-pointer disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-500"
                      aria-busy={testing}
                    >
                      {testing ? "Testing..." : "Test Connection"}
                    </button>
                  </div>
                )}
                {(settings.has_custom_ai_key || aiBaseUrl || aiApiKey || aiModel) && (
                  <button
                    type="button"
                    onClick={handleResetAi}
                    className="py-2 px-4 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-medium rounded-xl transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
                  >
                    Reset AI Settings
                  </button>
                )}
              </div>
              {aiBaseUrl && aiApiKey && aiModel && testResult && (
                <p
                  className={`text-xs ${testResult.valid ? "text-green-600" : "text-red-600"}`}
                  role="status"
                  aria-live="polite"
                >
                  {testResult.valid ? "Connection successful — key is valid." : testResult.error}
                </p>
              )}
            </fieldset>

            <fieldset className="rounded-2xl bg-gray-50 p-6 space-y-4">
              <legend className="sr-only">Web Search Settings</legend>
              <div>
                <p className="text-sm font-semibold text-gray-800">Web Search</p>
                <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                  Optional. Get a free key from{" "}
                  <a href="https://brave.com/search/api/" target="_blank" rel="noopener noreferrer" className="text-red-500 hover:underline">Brave Search API</a>.
                </p>
              </div>

              <div>
                <label htmlFor="brave-key" className="block text-sm text-gray-600">Brave Search API Key</label>
                <PasswordInput
                  id="brave-key"
                  value={braveKey}
                  onChange={setBraveKey}
                  className={inputClasses}
                  placeholder={settings.has_custom_brave_key ? "••••••••  (key set)" : "BSA..."}
                  ariaLabel="Brave Search API key"
                />
              </div>
              {settings.has_custom_brave_key && !braveKey && (
                <button
                  type="button"
                  onClick={handleResetBraveKey}
                  className="py-2 px-4 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-medium rounded-xl transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
                >
                  Reset Search Key
                </button>
              )}
            </fieldset>
          </div>
        )}

        {/* Save button — always visible */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 px-4 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white font-semibold rounded-xl shadow-sm hover:shadow-md transition-all cursor-pointer disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
          aria-busy={saving}
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>

        {/* Danger zone */}
        <div className="pt-4 border-t border-gray-200">
          <button
            onClick={() => setShowDeleteModal(true)}
            className="w-full py-3 px-4 bg-white border border-red-200 text-red-600 hover:bg-red-50 font-medium rounded-xl transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            Disconnect & Delete Account
          </button>
        </div>
      </div>

      <PageFooter />

      <ConfirmModal
        open={showDeleteModal}
        title="Delete Account"
        message="This will permanently delete your account and all data. This action cannot be undone."
        confirmLabel="Delete Account"
        onConfirm={handleDisconnect}
        onCancel={() => setShowDeleteModal(false)}
      />
    </main>
  );
}
