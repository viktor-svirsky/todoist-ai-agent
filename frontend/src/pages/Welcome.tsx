import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import PageFooter from "../components/PageFooter";

function WelcomeHero() {
  return (
    <section className="bg-gradient-to-b from-gray-50 to-white py-20 sm:py-28">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="flex justify-center mb-6">
          <span className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100" aria-hidden="true">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        </div>
        <h1
          id="welcome-heading"
          className="text-5xl sm:text-6xl font-extrabold tracking-tight bg-gradient-to-r from-red-500 to-violet-600 bg-clip-text text-transparent"
        >
          You're Connected!
        </h1>
        <p className="mt-6 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
          Your AI assistant is ready. Try it right now — it takes 10 seconds.
        </p>
      </div>
    </section>
  );
}

function TryItNowSection() {
  return (
    <section className="py-16 sm:py-20 bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl sm:text-4xl font-bold text-center text-gray-900">
          Try your first @ai command
        </h2>
        <p className="mt-4 text-center text-gray-500 max-w-xl mx-auto">
          Open Todoist, pick any task, and paste one of these into a comment:
        </p>

        <div className="mt-10 space-y-4">
          {[
            {
              command: "@ai break this task into smaller steps",
              label: "Task breakdown",
            },
            {
              command: "@ai what should I do first?",
              label: "Prioritization",
            },
            {
              command: "@ai help me plan this project",
              label: "Project planning",
            },
          ].map((item) => (
            <div
              key={item.command}
              className="flex items-center justify-between p-4 rounded-xl bg-gray-50 border border-gray-200"
            >
              <div>
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                  {item.label}
                </span>
                <p className="mt-1 font-mono text-sm text-gray-800">
                  {item.command}
                </p>
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(item.command)}
                className="shrink-0 ml-4 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Copy
              </button>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <a
            href="https://app.todoist.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center py-3.5 px-8 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl shadow-sm hover:shadow-md transition-all text-lg"
          >
            Open Todoist and Try It Now
            <svg className="ml-2 w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}

function SettingsHintSection({ onGoToSettings }: { onGoToSettings: () => void }) {
  return (
    <section className="py-12 sm:py-16 bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900">
          Want to customize?
        </h2>
        <p className="mt-3 text-gray-500 max-w-lg mx-auto">
          Add custom instructions, connect your own AI provider, or change the trigger word in Settings.
        </p>
        <div className="mt-6">
          <button
            onClick={onGoToSettings}
            className="inline-flex items-center py-2.5 px-6 bg-white border border-gray-300 hover:border-gray-400 text-gray-700 font-semibold rounded-xl shadow-sm hover:shadow-md transition-all text-base cursor-pointer"
          >
            Go to Settings
          </button>
        </div>
      </div>
    </section>
  );
}


export default function Welcome() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate("/");
      } else {
        setReady(true);
      }
    });
  }, [navigate]);

  if (!ready) return null;

  return (
    <main role="main" aria-labelledby="welcome-heading">
      <WelcomeHero />
      <TryItNowSection />
      <SettingsHintSection onGoToSettings={() => navigate("/settings")} />
      <PageFooter />
    </main>
  );
}
