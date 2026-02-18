import { spawn } from 'child_process';

const AGENT_TIMEOUT_MS = 120_000; // 2 minutes

export async function runAgent({ task, messages }) {
  // Build conversation history as readable text
  const history = messages.length > 0
    ? messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
    : '';

  const prompt = [
    `You are an AI assistant embedded in Viktor's Todoist.`,
    `You help solve tasks by reasoning, browsing the web, and running shell commands on this Mac.`,
    `Current task: "${task.content}"`,
    task.description ? `Task description: "${task.description}"` : '',
    '',
    history ? `Conversation so far:\n${history}` : '',
    '',
    `Respond concisely — your reply will be posted as a Todoist comment.`,
    `If you need to browse the web or run commands, use your available tools.`,
  ].filter(Boolean).join('\n');

  return new Promise((resolve, reject) => {
    let proc;

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`claude timed out after ${AGENT_TIMEOUT_MS / 1000}s`));
    }, AGENT_TIMEOUT_MS);

    proc = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
      env: { ...process.env, HOME: process.env.HOME },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', chunk => { stdout += chunk; });
    proc.stderr.on('data', chunk => { stderr += chunk; });

    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim() || '(no response)');
      } else {
        reject(new Error(`claude exited with code ${code}: ${stderr.trim()}`));
      }
    });

    proc.on('error', err => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}
