-- Ori's Space Party: one-time Supabase setup.
-- Run this in Supabase → SQL Editor → New query → paste → Run.
-- Replace __HOST_KEY__ with a long random secret first (the ready-to-run copy in private/ already has one).

-- ---------- tables ----------
create table if not exists public.photos (
  id uuid primary key,
  name text not null default '' check (char_length(name) <= 40),
  created_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists public.settings (
  id int primary key check (id = 1),
  data jsonb not null default '{}'::jsonb
);
insert into public.settings (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;

-- Holds the host secret. RLS is on with no policies, so browsers can never read it.
create table if not exists public.host_secret (key text not null);
delete from public.host_secret;
insert into public.host_secret (key) values ('__HOST_KEY__');

alter table public.photos enable row level security;
alter table public.settings enable row level security;
alter table public.host_secret enable row level security;

-- Explicit table permissions (works whether or not "Automatically expose new tables" is on).
-- RLS policies below narrow these down further.
grant usage on schema public to anon, authenticated;
grant select, insert on public.photos to anon, authenticated;
grant select on public.settings to anon, authenticated;
revoke all on public.host_secret from anon, authenticated;

-- ---------- what guests (anyone with the link) may do ----------
drop policy if exists "read photos" on public.photos;
create policy "read photos" on public.photos for select to anon, authenticated using (true);

drop policy if exists "add a photo" on public.photos;
create policy "add a photo" on public.photos for insert to anon, authenticated with check (deleted = false);

drop policy if exists "read settings" on public.settings;
create policy "read settings" on public.settings for select to anon, authenticated using (true);

-- ---------- host-only actions (need the secret key) ----------
create or replace function public.is_host(k text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.host_secret where key = k and length(k) >= 20);
$$;
revoke execute on function public.is_host(text) from public, anon, authenticated;

create or replace function public.host_check(k text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_host(k);
$$;

create or replace function public.host_save_settings(k text, patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.is_host(k) then raise exception 'not allowed'; end if;
  update public.settings set data = data || patch where id = 1 returning data into result;
  return result;
end $$;

create or replace function public.host_delete_photo(k text, pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_host(k) then raise exception 'not allowed'; end if;
  update public.photos set deleted = true where id = pid;
end $$;

create or replace function public.host_clear(k text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_host(k) then raise exception 'not allowed'; end if;
  update public.photos set deleted = true where deleted = false;
end $$;

grant execute on function public.host_check(text) to anon, authenticated;
grant execute on function public.host_save_settings(text, jsonb) to anon, authenticated;
grant execute on function public.host_delete_photo(text, uuid) to anon, authenticated;
grant execute on function public.host_clear(text) to anon, authenticated;

-- ---------- live updates ----------
do $$ begin
  alter publication supabase_realtime add table public.photos;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.settings;
exception when duplicate_object then null; end $$;

-- ---------- photo storage ----------
-- Public bucket: a photo can only be opened by someone who knows its random id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 15728640, array['image/*'])
on conflict (id) do update set public = true, file_size_limit = 15728640, allowed_mime_types = array['image/*'];

drop policy if exists "guests upload party photos" on storage.objects;
create policy "guests upload party photos" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'photos');

select 'Setup complete ✅' as result;
