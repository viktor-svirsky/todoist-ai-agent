export default function PageFooter() {
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
