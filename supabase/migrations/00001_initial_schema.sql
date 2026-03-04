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
  rate_limit_count    int not null default 0,
  rate_limit_reset_at timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Indexes
create index idx_users_config_todoist_user on users_config(todoist_user_id);

-- RLS
alter table users_config enable row level security;
create policy "users_own_config" on users_config
  for all using (auth.uid() = id);

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

-- Rate limiting function
-- Atomically increments the counter (resetting if window expired).
-- Returns true if the request is allowed, false if rate-limited.
create or replace function check_rate_limit(
  p_user_todoist_id text,
  p_max_requests int,
  p_window_seconds int
)
returns boolean
language plpgsql
as $$
declare
  v_allowed boolean;
begin
  update users_config
  set
    rate_limit_count = case
      when rate_limit_reset_at <= now() then 1
      else rate_limit_count + 1
    end,
    rate_limit_reset_at = case
      when rate_limit_reset_at <= now() then now() + (p_window_seconds || ' seconds')::interval
      else rate_limit_reset_at
    end
  where todoist_user_id = p_user_todoist_id
  returning rate_limit_count <= p_max_requests into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;
