import { supabase } from "../lib/supabase";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

function HeroSection({
  onConnect,
  connecting,
  error,
}: {
  onConnect: () => void;
  connecting: boolean;
  error: string | null;
}) {
  return (
    <section className="bg-gradient-to-b from-gray-50 to-white py-20 sm:py-28">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h1
          id="landing-heading"
          className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight bg-gradient-to-r from-red-500 to-violet-600 bg-clip-text text-transparent"
        >
          Todoist AI Agent
        </h1>
        <p className="mt-6 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
          An AI assistant that lives inside your Todoist. Mention{" "}
          <code className="bg-gray-200 px-1.5 py-0.5 rounded text-gray-800 font-mono text-sm">
            @ai
          </code>{" "}
          in any task comment and get an instant, intelligent response — with
          web search, conversation memory, and full control over your AI
          provider.
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

function FeaturesSection() {
  const features = [
    {
      icon: "💬",
      title: "Natural Conversations",
      description:
        "Comment @ai on any Todoist task to start a conversation. Ask questions, get summaries, brainstorm ideas — right where your work happens.",
    },
    {
      icon: "🔍",
      title: "Built-in Web Search",
      description:
        "The AI can search the web for current information using Brave Search, so your answers are always up to date.",
    },
    {
      icon: "🧠",
      title: "Conversation Memory",
      description:
        "Each task maintains its own conversation history. Continue discussions across multiple comments without repeating context.",
    },
    {
      icon: "🔑",
      title: "Bring Your Own Key",
      description:
        "Use the shared default AI or connect your own Anthropic, OpenAI, or any OpenAI-compatible provider for full control.",
    },
    {
      icon: "🖼️",
      title: "Image & File Analysis",
      description:
        "Attach images, PDFs, or text files to your comments. The AI analyzes them and responds with relevant insights.",
    },
    {
      icon: "⚡",
      title: "Custom Trigger Word",
      description:
        "Change the default @ai trigger to any word you prefer. Personalize how you interact with your AI assistant.",
    },
  ];

  return (
    <section className="py-16 sm:py-20 bg-white" aria-labelledby="features-heading">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2
          id="features-heading"
          className="text-3xl sm:text-4xl font-bold text-center text-gray-900"
        >
          Everything You Need from an AI for Todoist
        </h2>
        <p className="mt-4 text-center text-gray-500 max-w-2xl mx-auto">
          A complete Todoist AI integration that adds intelligent assistance
          directly into your task workflow.
        </p>

        <ul
          className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
          aria-label="Features"
        >
          {features.map((feature) => (
            <li
              key={feature.title}
              className="p-6 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-colors"
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
        'Go to any task in Todoist and add a comment starting with @ai. Ask anything: "What does this error mean?", "Summarize this document", "Help me plan this project".',
    },
    {
      step: "3",
      title: "Get an AI Response",
      description:
        "The AI reads your message, searches the web if needed, and posts a response as a new comment on the same task. It's that simple.",
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

        <ol className="mt-12 space-y-8" aria-label="Steps">
          {steps.map((item) => (
            <li key={item.step} className="flex gap-6 items-start">
              <span
                className="shrink-0 w-12 h-12 rounded-full bg-red-500 text-white font-bold text-xl flex items-center justify-center"
                aria-hidden="true"
              >
                {item.step}
              </span>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {item.title}
                </h3>
                <p className="mt-1 text-gray-600 leading-relaxed">
                  {item.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
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

function FooterLinks() {
  return (
    <footer className="py-8 bg-gray-50">
      <p className="text-center text-xs text-gray-400">
        <a
          href="https://github.com/viktor-svirsky/todoist-ai-agent"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-gray-600 transition-colors"
        >
          GitHub
        </a>
        {" · "}
        <a
          href="https://github.com/viktor-svirsky/todoist-ai-agent/issues/new?template=bug_report.yml"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-gray-600 transition-colors"
        >
          Report a Bug
        </a>
        {" · "}
        <a
          href="https://github.com/viktor-svirsky/todoist-ai-agent/issues/new?template=feature_request.yml"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-gray-600 transition-colors"
        >
          Request a Feature
        </a>
      </p>
    </footer>
  );
}

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
    <main role="main" aria-labelledby="landing-heading">
      <HeroSection
        onConnect={handleConnect}
        connecting={connecting}
        error={error}
      />
      <FeaturesSection />
      <HowItWorksSection />
      <FAQSection />
      <CTASection onConnect={handleConnect} connecting={connecting} />
      <FooterLinks />
    </main>
  );
}
