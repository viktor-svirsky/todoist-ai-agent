import { Link } from "react-router-dom";
import PublicLayout from "../components/PublicLayout";
import { Head } from "../components/Head";

export default function PricingCanceled() {
  return (
    <PublicLayout>
      <Head
        title="Checkout canceled — Todoist AI Agent"
        description="Checkout canceled. No charge was made."
      />
      <section className="max-w-md mx-auto text-center py-20 px-4">
        <h1 className="text-2xl font-bold text-gray-900">
          Checkout canceled.
        </h1>
        <p className="mt-3 text-gray-600">
          No charge was made. You can start your Pro plan anytime.
        </p>
        <Link
          to="/pricing"
          className="mt-6 inline-flex rounded-md bg-gray-900 text-white px-4 py-2 hover:bg-gray-800"
        >
          Back to pricing
        </Link>
      </section>
    </PublicLayout>
  );
}
