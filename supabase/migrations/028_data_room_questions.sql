-- 028_data_room_questions.sql
-- Data room Phase 4: viewer Q&A. A viewer of a data-room share link can ask the
-- owner a question from the viewer page; the owner answers from the dashboard.
--
-- Questions are PRIVATE between the asker (viewer session) and the owner — a
-- viewer only ever sees their own thread, never other viewers' questions. The
-- visitor's insert + own-thread read run through the service-role client
-- (anonymous viewers), so there is intentionally NO authenticated insert / no
-- viewer-facing select policy — mirrors file_request_uploads (023).

create table if not exists public.data_room_questions (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  -- The share link the viewer used. SET NULL on link delete so the Q&A thread
  -- (and its audit value) survives a link being trashed / removed.
  link_id uuid references public.share_links(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- Viewer session that asked — lets the viewer see only their own thread, and
  -- the owner attribute a thread to one visitor.
  session_id text,
  asker_email text,
  body text not null check (char_length(trim(body)) > 0 and char_length(body) <= 2000),
  answer text check (answer is null or char_length(answer) <= 4000),
  answered_at timestamptz,
  ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Owner room listing (newest first).
create index if not exists idx_drq_collection on public.data_room_questions(collection_id, created_at desc);
-- Viewer own-thread lookup (their session within a room — session cookie is
-- path '/', so it spans every link of the room).
create index if not exists idx_drq_collection_session on public.data_room_questions(collection_id, session_id);
-- Owner-wide queries (e.g. a future "unanswered" badge across rooms).
create index if not exists idx_drq_owner on public.data_room_questions(owner_id, created_at desc);

drop trigger if exists trg_data_room_questions_updated_at on public.data_room_questions;
create trigger trg_data_room_questions_updated_at
before update on public.data_room_questions
for each row
execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────
-- RLS — owner-scoped. The owner reads every question for their rooms and writes
-- answers (update). Viewer insert + own-thread read go through the service-role
-- client, so there is NO authenticated insert and NO viewer select policy.
alter table public.data_room_questions enable row level security;

create policy "owners can view own room questions"
  on public.data_room_questions for select to authenticated
  using (owner_id = auth.uid());

create policy "owners can answer own room questions"
  on public.data_room_questions for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "owners can delete own room questions"
  on public.data_room_questions for delete to authenticated
  using (owner_id = auth.uid());

-- ───────────────────────────────────────────────────────────
-- 'question_asked' becomes a subscribable automation event (Teams/webhook) so
-- owners can be pinged when a viewer asks. Like file_uploaded it is NOT a
-- link_event, so link_events constraints are untouched — only the subscription
-- event set is widened (023's set + file_uploaded + question_asked).
alter table public.automation_subscriptions
  drop constraint if exists automation_subscriptions_event_types_check;
alter table public.automation_subscriptions
  add constraint automation_subscriptions_event_types_check check (
    event_types <@ array['view', 'denied', 'email_submitted', 'password_failed', 'download', 'agreement', 'file_uploaded', 'question_asked']::text[]
    and array_length(event_types, 1) > 0
  );
