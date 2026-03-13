import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <main
      className="min-h-screen bg-gray-100 flex flex-col items-center justify-center px-4 sm:px-6"
      role="main"
      aria-labelledby="not-found-heading"
    >
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 sm:p-10 text-center space-y-4">
        <h1
          id="not-found-heading"
          className="text-6xl font-extrabold text-gray-300"
        >
          404
        </h1>
        <p className="text-gray-600 text-base">
          The page you're looking for doesn't exist.
        </p>
        <Link
          to="/"
          className="inline-block mt-2 py-2.5 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-sm hover:shadow-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Go Home
        </Link>
      </div>
    </main>
  );
}
