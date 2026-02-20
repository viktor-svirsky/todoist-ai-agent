# Todoist AI Agent

An autonomous AI agent that monitors Todoist tasks labeled "AI" and responds to them using Claude (claude-sonnet-4-5) with access to browser automation and the Todoist REST API.

## Features

- **Webhook-based operation**: Real-time event processing from Todoist
- **AI-powered**: Uses Claude Sonnet 4.5 for intelligent task processing
- **Automated responses**: Posts AI-generated responses as Todoist comments
- **Conversation history**: Maintains context across multiple interactions per task
- **LaunchAgent integration**: Runs as a background service on macOS
- **Fault-tolerant**: Continues working even if webhooks fail to deliver

## Architecture

```
Todoist → webhook POST → Express (port 9000) → async job queue → Agent Loop → Todoist comment
                                                                       ↓
                                                             Claude (via CLI)
                                                                       ↓
                                                                Todoist REST API
```

## Setup

### Prerequisites

- Node.js 18+
- Todoist account with API access
- Claude CLI installed and configured
- macOS (for LaunchAgent setup)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd todoist-ai-agent
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your credentials:
   - `TODOIST_API_TOKEN`: Your Todoist API token
   - `TODOIST_CLIENT_ID`: Your Todoist app client ID
   - `TODOIST_CLIENT_SECRET`: Your Todoist app client secret
   - `TODOIST_WEBHOOK_SECRET`: Your webhook secret (same as client secret)
   - `PORT`: Server port (default: 9000)

4. **Set up Todoist App**
   - Go to [Todoist App Management](https://app.todoist.com/app/settings/integrations/app-management)
   - Create a new app or use existing
   - Configure webhook:
     - URL: `https://your-domain.com/webhook`
     - Events: `item:added`, `item:updated`, `item:completed`, `note:added`
   - Complete OAuth authorization flow

5. **Install as LaunchAgent** (optional, for auto-start)
   ```bash
   cp com.user.todoist-ai-agent.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.user.todoist-ai-agent.plist
   ```

### Manual Run

```bash
npm start
```

The server will listen on port 9000 (or the PORT specified in .env).

## Usage

1. Create a task in Todoist
2. Add the **"AI"** label to the task
3. The agent will automatically process the task and post a response as a comment
4. Add comments to continue the conversation with the agent

## API Endpoints

- `POST /webhook` - Receives Todoist webhook events
- `GET /health` - Health check endpoint

## File Structure

```
todoist-ai-agent/
├── src/
│   ├── index.ts                      # Main entry point
│   ├── server.ts                     # Express app, webhook endpoint
│   ├── handlers/
│   │   ├── webhook.handler.ts        # Webhook event handler
│   │   └── polling.handler.ts        # Polling service handler
│   ├── services/
│   │   ├── claude.service.ts         # Claude CLI integration
│   │   ├── todoist.service.ts        # Todoist REST API client
│   │   ├── task-processor.service.ts # Task processing logic
│   │   └── notification.service.ts   # Notification service
│   ├── repositories/
│   │   └── conversation.repository.ts # Conversation storage
│   ├── types/
│   │   └── index.ts                  # TypeScript type definitions
│   └── utils/
│       ├── config.ts                 # Configuration management
│       ├── logger.ts                 # Logging utility
│       └── constants.ts              # App constants
├── tests/                            # Test files
├── dist/                             # Compiled JavaScript
├── data/
│   └── conversations.json            # Persisted conversation history
├── .env                              # Environment configuration
├── com.user.todoist-ai-agent.plist   # LaunchAgent configuration
└── package.json
```

## Configuration

### LaunchAgent (macOS)

The `com.user.todoist-ai-agent.plist` file configures the agent as a macOS LaunchAgent:
- Auto-starts on login
- Restarts on crash
- Logs to `~/Library/Logs/todoist-ai-agent.log`

Update the paths in the plist file to match your installation directory.

## Troubleshooting

### Webhooks not working

1. **Verify OAuth authorization**: The Todoist app must be properly authorized via OAuth
2. **Check webhook configuration**: Ensure webhook URL is correct and events are selected
3. **Monitor logs**: `tail -f ~/Library/Logs/todoist-ai-agent.log`
4. **Test endpoint**: `curl https://your-domain.com/health`

### Service not starting

```bash
# Check LaunchAgent status
launchctl list | grep todoist

# View logs
tail -50 ~/Library/Logs/todoist-ai-agent.log

# Restart service
launchctl kickstart -k gui/$(id -u)/com.user.todoist-ai-agent
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build TypeScript
npm run build

# Run in development mode
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint

# Run tests with coverage
npm run test:coverage
```

### Debug mode

Set `DEBUG=*` environment variable for verbose logging.

## Security

- **HMAC Verification**: All webhook requests are verified using HMAC-SHA256 signatures
- **Environment Variables**: Sensitive credentials are stored in `.env` (not committed)
- **HTTPS Required**: Webhook endpoint must use HTTPS in production

## License

ISC

## Credits

Built with:
- [Express](https://expressjs.com/) - Web framework
- [Axios](https://axios-http.com/) - HTTP client
- [Claude CLI](https://claude.com/claude-code) - AI agent runtime
- [Todoist API](https://developer.todoist.com/) - Task management
