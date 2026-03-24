import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import PageFooter from "../components/PageFooter";
import StepList from "../components/StepList";

function WelcomeHero({ onGoToSettings }: { onGoToSettings: () => void }) {
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
          Your Todoist account is linked and ready to go. Here's everything you
          need to start using your AI assistant.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            onClick={onGoToSettings}
            className="inline-flex items-center py-3.5 px-8 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl shadow-sm hover:shadow-md transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 text-lg"
          >
            Go to Settings
          </button>
          <a
            href="https://app.todoist.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center py-3.5 px-8 bg-white border border-gray-300 hover:border-gray-400 text-gray-700 font-semibold rounded-xl shadow-sm hover:shadow-md transition-all text-lg"
          >
            Open Todoist
          </a>
        </div>
      </div>
    </section>
  );
}

function HowToUseSection() {
  const steps = [
    {
      step: "1",
      title: "Open Any Task in Todoist",
      description:
        "Go to any task in any project. The AI works with all your tasks — personal, shared, or team projects.",
    },
    {
      step: "2",
      title: "Comment @ai With Your Question",
      description:
        'Add a comment starting with @ai. Ask anything: "Summarize this", "Help me plan", "What does this mean?" — the AI understands context.',
    },
    {
      step: "3",
      title: "Get an Instant AI Response",
      description:
        "The AI reads your message, searches the web if needed, and posts a response as a new comment on the same task.",
    },
  ];

  return (
    <section
      className="py-16 sm:py-20 bg-gray-50"
      aria-labelledby="how-to-use-heading"
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2
          id="how-to-use-heading"
          className="text-3xl sm:text-4xl font-bold text-center text-gray-900"
        >
          Here's How to Use It
        </h2>
        <p className="mt-4 text-center text-gray-500 max-w-2xl mx-auto">
          Three steps to start getting AI responses in your Todoist tasks.
        </p>

        <StepList steps={steps} ariaLabel="Getting started steps" />
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
      <WelcomeHero onGoToSettings={() => navigate("/settings")} />
      <HowToUseSection />
      <PageFooter />
    </main>
  );
}
