#!/usr/bin/env node
import 'dotenv/config';

const WEBHOOK_URL = 'https://9635783.xyz/webhook';

async function listWebhooks() {
  const url = 'https://api.todoist.com/sync/v9/webhooks/list';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.TODOIST_API_TOKEN}`,
      'Content-Type': 'application/json',
    }
  });

  if (!response.ok) {
    console.error('Failed to list webhooks:', response.status, await response.text());
    return [];
  }

  const data = await response.json();
  return data.webhooks || [];
}

async function registerWebhook() {
  const url = 'https://api.todoist.com/sync/v9/webhooks/add';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.TODOIST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: WEBHOOK_URL,
      events: ['item:added', 'item:updated', 'item:completed', 'note:added'],
    })
  });

  if (!response.ok) {
    console.error('Failed to register webhook:', response.status, await response.text());
    return null;
  }

  const data = await response.json();
  console.log('Webhook registered:', data);
  return data;
}

async function main() {
  console.log('Checking existing webhooks...');
  const webhooks = await listWebhooks();

  console.log(`Found ${webhooks.length} webhook(s):`);
  webhooks.forEach((wh, i) => {
    console.log(`  ${i + 1}. ${wh.url} (ID: ${wh.id})`);
    console.log(`     Events: ${wh.events.join(', ')}`);
  });

  const existing = webhooks.find(wh => wh.url === WEBHOOK_URL);

  if (existing) {
    console.log(`\n✓ Webhook already registered for ${WEBHOOK_URL}`);
    console.log(`  ID: ${existing.id}`);
    console.log(`  Events: ${existing.events.join(', ')}`);
  } else {
    console.log(`\nNo webhook found for ${WEBHOOK_URL}`);
    console.log('Registering webhook...');
    await registerWebhook();
  }
}

main().catch(console.error);
