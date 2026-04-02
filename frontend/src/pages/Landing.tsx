import { supabase } from "../lib/supabase";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageFooter from "../components/PageFooter";
import StepList from "../components/StepList";

function HeroSection({
  onConnect,
  connecting,
  error,
  userCount,
}: {
  onConnect: () => void;
  connecting: boolean;
  error: string | null;
  userCount: number | null;
}) {
  return (
    <section className="bg-gradient-to-b from-gray-50 to-white py-20 sm:py-28">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {userCount !== null && userCount > 0 && (
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-50 text-green-700 text-sm font-medium mb-6">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            {userCount}+ Todoist users connected
          </div>
        )}
        <h1
          id="landing-heading"
          className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight bg-gradient-to-r from-red-500 to-violet-600 bg-clip-text text-transparent"
        >
          AI that lives in your Todoist
        </h1>
        <p className="mt-6 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
          Stop context-switching. Ask questions, break down tasks, research
          ideas — all from your task comments. Just type{" "}
          <code className="bg-gray-200 px-1.5 py-0.5 rounded text-gray-800 font-mono text-sm">
            @ai
          </code>{" "}
          and get an answer right where your work happens.
        </p>

        {error && (
          <div
            className="mt-6 p-3 rounded-xl bg-red-50 text-red-600 text-sm text-center max-w-md mx-auto"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="mt-10">
          <button
            onClick={onConnect}
            disabled={connecting}
            className="inline-flex items-center py-3.5 px-8 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white font-semibold rounded-xl shadow-sm hover:shadow-md transition-all cursor-pointer disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 text-lg"
            aria-busy={connecting}
          >
            {connecting ? "Redirecting..." : "Connect Todoist — It's Free"}
          </button>
          <p className="mt-3 text-sm text-gray-400">
            No credit card required. Works with your existing Todoist account.
          </p>
        </div>
      </div>
    </section>
  );
}

function DemoSection() {
  return (
    <section className="py-12 sm:py-16 bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-center text-gray-900 mb-4">
          See it in action
        </h2>
        <p className="text-center text-gray-500 max-w-xl mx-auto mb-8">
          Type <code className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-700 font-mono text-sm">@ai</code> in
          any Todoist comment. The AI reads your task, thinks, and replies — right in the thread.
        </p>
        <div className="rounded-2xl overflow-hidden border border-gray-200 shadow-sm">
          <img
            src="/demo.gif"
            alt="Demo showing @ai being used in a Todoist task comment to get an AI response"
            className="w-full"
            loading="lazy"
          />
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const steps = [
    {
      step: "1",
      title: "Connect Your Todoist",
      description:
        "Sign in with your Todoist account in one click. No setup, no configuration files — just OAuth and you're in.",
    },
    {
      step: "2",
      title: "Comment @ai on Any Task",
      description:
        'Go to any task and add a comment starting with @ai. Try: "@ai break this into subtasks", "@ai what\'s blocking this?", or "@ai research options for this".',
    },
    {
      step: "3",
      title: "Get an AI Response",
      description:
        "The AI reads your task and all its context, searches the web if needed, and replies as a comment on the same task. Keep the conversation going across multiple comments.",
    },
  ];

  return (
    <section
      className="py-16 sm:py-20 bg-gray-50"
      aria-labelledby="how-it-works-heading"
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2
          id="how-it-works-heading"
          className="text-3xl sm:text-4xl font-bold text-center text-gray-900"
        >
          How It Works
        </h2>
        <p className="mt-4 text-center text-gray-500 max-w-2xl mx-auto">
          Three steps to add AI to your Todoist workflow.
        </p>

        <StepList steps={steps} ariaLabel="Steps" />
      </div>
    </section>
  );
}

function UseCasesSection() {
  const useCases = [
    {
      icon: "🎯",
      title: "Break Down Complex Tasks",
      description:
        'Comment "@ai break this into subtasks" on any overwhelming task and get a structured action plan in seconds.',
    },
    {
      icon: "🔍",
      title: "Research Without Leaving Todoist",
      description:
        "Need to compare tools, look up a deadline, or check a fact? The AI searches the web and brings the answer to your task.",
    },
    {
      icon: "💡",
      title: "Brainstorm and Plan Projects",
      description:
        "Describe what you want to accomplish and get a structured project plan, complete with milestones and next steps.",
    },
    {
      icon: "📎",
      title: "Analyze Files and Images",
      description:
        "Attach a PDF, screenshot, or document to your comment. The AI reads it and responds with relevant insights.",
    },
  ];

  return (
    <section className="py-16 sm:py-20 bg-white" aria-labelledby="use-cases-heading">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2
          id="use-cases-heading"
          className="text-3xl sm:text-4xl font-bold text-center text-gray-900"
        >
          What Can You Do With It?
        </h2>
        <p className="mt-4 text-center text-gray-500 max-w-2xl mx-auto">
          Real use cases from real Todoist workflows — not abstract features.
        </p>

        <ul
          className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-6"
          aria-label="Use cases"
        >
          {useCases.map((item) => (
            <li
              key={item.title}
              className="p-6 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <span className="text-3xl" aria-hidden="true">
                {item.icon}
              </span>
              <h3 className="mt-3 text-lg font-semibold text-gray-900">
                {item.title}
              </h3>
              <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                {item.description}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PowerFeaturesSection() {
  const features = [
    {
      icon: "🧠",
      title: "Conversation Memory",
      description:
        "Each task keeps its own conversation history. Follow up across comments without repeating yourself.",
    },
    {
      icon: "🔑",
      title: "Bring Your Own Key",
      description:
        "Use the free shared AI, or connect your own Anthropic, OpenAI, or any OpenAI-compatible provider.",
    },
    {
      icon: "⚡",
      title: "Custom Trigger Word",
      description:
        "Change the default @ai trigger to any word you prefer. Make it yours.",
    },
  ];

  return (
    <section className="py-16 sm:py-20 bg-gray-50" aria-labelledby="power-features-heading">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2
          id="power-features-heading"
          className="text-3xl sm:text-4xl font-bold text-center text-gray-900"
        >
          For Power Users
        </h2>
        <p className="mt-4 text-center text-gray-500 max-w-2xl mx-auto">
          Fine-tune the experience to fit your workflow.
        </p>

        <ul
          className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6"
          aria-label="Power features"
        >
          {features.map((feature) => (
            <li
              key={feature.title}
              className="p-6 rounded-2xl bg-white border border-gray-200 hover:border-gray-300 transition-colors"
            >
              <span className="text-3xl" aria-hidden="true">
                {feature.icon}
              </span>
              <h3 className="mt-3 text-lg font-semibold text-gray-900">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                {feature.description}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FAQSection() {
  const faqs = [
    {
      question: "Is Todoist AI Agent free?",
      answer:
        "Yes, Todoist AI Agent is completely free to use. You can use the shared default AI provider at no cost, or bring your own API key for more control.",
    },
    {
      question: "Which AI models are supported?",
      answer:
        "The default provider uses Anthropic's Claude. You can also connect any OpenAI-compatible API, including OpenAI GPT models, open-source models via OpenRouter, or self-hosted endpoints.",
    },
    {
      question: "Is my data secure?",
      answer:
        "Absolutely. All API keys and tokens are encrypted with AES-256-GCM at rest. Row Level Security ensures complete data isolation between users. Your Todoist credentials are never stored in plain text.",
    },
    {
      question: "Can I use my own API key?",
      answer:
        'Yes. In Settings, you can configure a custom AI provider with your own API key, base URL, and model name. The app validates your key before saving. You can also add your own Brave Search API key for web search.',
    },
    {
      question: "What is the trigger word?",
      answer:
        'The default trigger word is @ai — just include it in a Todoist comment to activate the AI. You can change it to any word you prefer in the Settings page after connecting your account.',
    },
    {
      question: "Does it work with Todoist Business / Teams?",
      answer:
        "Yes. Each team member connects their own account independently. The AI responds to comments made by the connected user, regardless of whether the Todoist workspace is personal or shared.",
    },
  ];

  return (
    <section
      className="py-16 sm:py-20 bg-white"
      aria-labelledby="faq-heading"
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2
          id="faq-heading"
          className="text-3xl sm:text-4xl font-bold text-center text-gray-900"
        >
          Frequently Asked Questions
        </h2>

        <div className="mt-12 divide-y divide-gray-200">
          {faqs.map((faq) => (
            <details key={faq.question} className="group py-5">
              <summary className="cursor-pointer list-none flex justify-between items-center text-left font-medium text-gray-900 hover:text-red-500 transition-colors">
                <span>{faq.question}</span>
                <span
                  className="ml-4 shrink-0 text-gray-400 group-open:rotate-45 transition-transform"
                  aria-hidden="true"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 text-gray-600 leading-relaxed">
                {faq.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection({
  onConnect,
  connecting,
}: {
  onConnect: () => void;
  connecting: boolean;
}) {
  return (
    <section className="py-16 sm:py-20 bg-gray-900" aria-labelledby="cta-heading">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h2
          id="cta-heading"
          className="text-3xl sm:text-4xl font-bold text-white"
        >
          Ready to Add AI to Your Todoist?
        </h2>
        <p className="mt-4 text-gray-400 text-lg">
          Connect your account in seconds. No credit card, no setup hassle.
        </p>
        <div className="mt-8">
          <button
            onClick={onConnect}
            disabled={connecting}
            className="inline-flex items-center py-3.5 px-8 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white font-semibold rounded-xl shadow-sm hover:shadow-md transition-all cursor-pointer disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 text-lg"
            aria-busy={connecting}
          >
            {connecting ? "Redirecting..." : "Connect Todoist — It's Free"}
          </button>
        </div>
      </div>
    </section>
  );
}


export default function Landing() {
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState(false);
  const [userCount, setUserCount] = useState<number | null>(null);
  const [error] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("error") ? "Authentication failed. Please try again." : null;
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/settings");
    });
  }, [navigate]);

  useEffect(() => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!supabaseUrl) return;
    fetch(`${supabaseUrl}/functions/v1/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.users) {
          // Round down to nearest 10 for social proof (e.g. 55 → 50, 123 → 120)
          setUserCount(Math.floor(data.users / 10) * 10);
        }
      })
      .catch(() => {});
  }, []);

  const handleConnect = () => {
    setConnecting(true);
    sessionStorage.setItem("oauth_pending", "true");
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    window.location.href = `${supabaseUrl}/functions/v1/auth-start`;
  };

  return (
    <main role="main" aria-labelledby="landing-heading">
      <HeroSection
        onConnect={handleConnect}
        connecting={connecting}
        error={error}
        userCount={userCount}
      />
      <DemoSection />
      <HowItWorksSection />
      <UseCasesSection />
      <PowerFeaturesSection />
      <FAQSection />
      <CTASection onConnect={handleConnect} connecting={connecting} />
      <PageFooter />
    </main>
  );
}
