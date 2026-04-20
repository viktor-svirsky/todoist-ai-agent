-- Single "control task" per user: the Todoist task where the agent chat lives.
-- When set, the webhook handler only responds to comments posted on this task.
-- When NULL, the handler falls back to legacy behavior (respond anywhere the
-- trigger word appears) so pre-existing users are not silently broken.

ALTER TABLE users_config
  ADD COLUMN control_task_id text;

CREATE INDEX idx_users_config_control_task ON users_config(control_task_id);
