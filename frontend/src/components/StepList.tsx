export interface Step {
  step: string;
  title: string;
  description: string;
}

export default function StepList({
  steps,
  ariaLabel,
}: {
  steps: Step[];
  ariaLabel: string;
}) {
  return (
    <ol className="mt-12 space-y-8" aria-label={ariaLabel}>
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
  );
}
