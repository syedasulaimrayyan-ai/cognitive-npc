-- Cognitive NPC: persistent per-player, per-NPC memory.
--
-- Identity model: the game uses Supabase **Anonymous Sign-In** — every browser
-- gets a real auth.users row and a JWT (no login UI). Row Level Security then
-- scopes every row to auth.uid() = that player. The Edge Function carries the
-- player's own JWT, so even server-side reads/writes run AS that player under
-- RLS — no service-role key is needed anywhere in this integration.

create table if not exists public.players (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.npc_memories (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users (id) on delete cascade,
  npc_id text not null check (char_length(npc_id) between 1 and 64),
  -- 'identity' | 'promise' | 'fact' | 'feeling' | 'event' | 'kindness' | 'offense' ...
  type text not null default 'fact' check (char_length(type) between 1 and 40),
  summary text not null check (char_length(summary) between 1 and 500),
  salience int not null default 3 check (salience between 1 and 5),
  keywords text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists npc_memories_player_npc_idx
  on public.npc_memories (player_id, npc_id, created_at desc);

create table if not exists public.npc_relationships (
  player_id uuid not null references auth.users (id) on delete cascade,
  npc_id text not null check (char_length(npc_id) between 1 and 64),
  trust int not null default 0 check (trust between -100 and 100),
  updated_at timestamptz not null default now(),
  primary key (player_id, npc_id)
);

-- ---------------------------------------------------------------------------
-- RLS: a player sees and touches ONLY their own rows. No anon policies:
-- anonymous sign-in users hold `authenticated` JWTs.
-- ---------------------------------------------------------------------------
alter table public.players enable row level security;
alter table public.npc_memories enable row level security;
alter table public.npc_relationships enable row level security;

create policy "players manage own row"
  on public.players for all to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

create policy "memories read own"
  on public.npc_memories for select to authenticated
  using (auth.uid() = player_id);
create policy "memories insert own"
  on public.npc_memories for insert to authenticated
  with check (auth.uid() = player_id);
create policy "memories update own"
  on public.npc_memories for update to authenticated
  using (auth.uid() = player_id) with check (auth.uid() = player_id);
create policy "memories delete own"
  on public.npc_memories for delete to authenticated
  using (auth.uid() = player_id);

create policy "relationships read own"
  on public.npc_relationships for select to authenticated
  using (auth.uid() = player_id);
create policy "relationships upsert own"
  on public.npc_relationships for insert to authenticated
  with check (auth.uid() = player_id);
create policy "relationships update own"
  on public.npc_relationships for update to authenticated
  using (auth.uid() = player_id) with check (auth.uid() = player_id);
