-- Ori's Space Party: add renaming photos from the host page.
-- Run once in Supabase → SQL Editor → New query → paste → Run. (Safe to run again.)
-- Uses the same host password check as removing photos, so guests can't rename anything.

create or replace function public.host_rename_photo(k text, pid uuid, newname text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_host(k) then raise exception 'not allowed'; end if;
  update public.photos set name = left(btrim(coalesce(newname, '')), 40) where id = pid;
end $$;

grant execute on function public.host_rename_photo(text, uuid, text) to anon, authenticated;

select 'Renaming is ready ✅' as result;
