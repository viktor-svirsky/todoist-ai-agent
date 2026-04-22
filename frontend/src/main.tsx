import { initSentry, Sentry } from "./lib/sentry";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import Welcome from "./pages/Welcome";
import Settings from "./pages/Settings";
import AuthCallback from "./pages/AuthCallback";
import BillingReturn from "./pages/BillingReturn";
import Pricing from "./pages/Pricing";
import PricingSuccess from "./pages/PricingSuccess";
import PricingCanceled from "./pages/PricingCanceled";
import NotFound from "./pages/NotFound";
import "./index.css";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Uncaught error:", error, info);
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack ?? "" } },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen bg-gray-100 flex items-center justify-center px-4 sm:px-6" role="main">
          <div className="bg-white rounded-2xl shadow-xl p-8 sm:p-10 text-center">
            <p className="text-gray-600" role="alert">Something went wrong. Please refresh the page.</p>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

initSentry();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/billing/return" element={<BillingReturn />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/pricing/success" element={<PricingSuccess />} />
          <Route path="/pricing/canceled" element={<PricingCanceled />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
