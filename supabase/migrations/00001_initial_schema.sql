-- Enable required extensions
create extension if not exists "pgsodium";

-- Users config table
create table users_config (
  id                  uuid primary key references auth.users(id) on delete cascade,
  todoist_token       text not null,
  todoist_user_id     text unique not null,
  webhook_secret      text not null,
  trigger_word        text not null default '@ai',
  custom_ai_base_url  text,
  custom_ai_api_key   text,
  custom_ai_model     text,
  custom_brave_key    text,
  max_messages        int not null default 20,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Conversations table
create table conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users_config(id) on delete cascade,
  task_id         text not null,
  title           text,
  created_at      timestamptz not null default now(),
  last_activity   timestamptz not null default now(),
  unique(user_id, task_id)
);

-- Messages table
create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);

-- Indexes
create index idx_conversations_user_task on conversations(user_id, task_id);
create index idx_messages_conversation on messages(conversation_id, created_at);
create index idx_users_config_todoist_user on users_config(todoist_user_id);

-- RLS
alter table users_config enable row level security;
create policy "users_own_config" on users_config
  for all using (auth.uid() = id);

alter table conversations enable row level security;
create policy "users_own_conversations" on conversations
  for all using (auth.uid() = user_id);

alter table messages enable row level security;
create policy "users_own_messages" on messages
  for all using (
    conversation_id in (
      select id from conversations where user_id = auth.uid()
    )
  );

-- Updated_at trigger
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger users_config_updated_at
  before update on users_config
  for each row execute function update_updated_at();
