import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import PageFooter from "./PageFooter";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white flex flex-col">
      <header className="px-4 sm:px-6 lg:px-8 py-4 border-b border-gray-200">
        <nav className="max-w-5xl mx-auto flex items-center justify-between">
          <Link to="/" className="font-semibold tracking-tight">
            Todoist AI Agent
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link
              to="/pricing"
              className="text-gray-700 hover:text-gray-900"
            >
              Pricing
            </Link>
            <Link
              to="/"
              className="rounded-md bg-gray-900 text-white px-3 py-1.5 hover:bg-gray-800"
            >
              Sign in
            </Link>
          </div>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <PageFooter />
    </div>
  );
}
