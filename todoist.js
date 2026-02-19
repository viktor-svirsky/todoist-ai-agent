import axios from 'axios';
import 'dotenv/config';

const BASE = 'https://api.todoist.com/api/v1';
const headers = () => ({ Authorization: `Bearer ${process.env.TODOIST_API_TOKEN}` });

export async function getTask(taskId) {
  const { data } = await axios.get(`${BASE}/tasks/${taskId}`, { headers: headers() });
  return data;
}

export async function hasAiLabel(taskId) {
  const task = await getTask(taskId);
  return (task.labels ?? []).includes('AI');
}

export async function postComment(taskId, content) {
  // Add AI indicator to make it clear this is an automated response
  const aiContent = `🤖 **AI Agent**\n\n${content}`;
  await axios.post(`${BASE}/comments`, { task_id: taskId, content: aiContent }, { headers: headers() });
}

export async function getBotUid() {
  const { data } = await axios.get('https://api.todoist.com/sync/v9/user', { headers: headers() });
  return String(data.id);
}
