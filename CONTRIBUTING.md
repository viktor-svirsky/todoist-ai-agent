# Contributing

Thanks for your interest in contributing to Todoist AI Agent!

## Development Setup

See the [Getting Started](README.md#getting-started) section in the README for full setup instructions.

## Making Changes

1. **Fork** the repository
2. **Create a branch** from `main` (`git checkout -b feat/your-feature`)
3. **Make your changes** — keep commits focused and atomic
4. **Run tests** — `npm test`
5. **Lint your code** — `cd frontend && npm run lint`
6. **Open a Pull Request** against `main`

## Pull Request Guidelines

- Fill out the PR template completely
- Keep PRs small and focused on a single concern
- Include tests for new functionality
- Update documentation if behavior changes
- Ensure CI passes before requesting review

## Code Style

- **Edge Functions (Deno/TypeScript)**: Follow Deno conventions, use `deno lint` and `deno fmt`
- **Frontend (React/TypeScript)**: Follow ESLint + Prettier configuration in the project

## Reporting Issues

Use the [GitHub issue templates](https://github.com/viktor-svirsky/todoist-ai-agent/issues/new/choose):

- **Bug Report** — for something that's broken
- **Feature Request** — for new functionality ideas

## Security

If you discover a security vulnerability, please report it privately via [GitHub Security Advisories](https://github.com/viktor-svirsky/todoist-ai-agent/security/advisories/new) rather than opening a public issue.
