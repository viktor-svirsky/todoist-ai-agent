-- Drop conversation history tables — message history is now read
-- directly from Todoist comments API, keeping all data in Todoist.
drop table if exists messages cascade;
drop table if exists conversations cascade;
