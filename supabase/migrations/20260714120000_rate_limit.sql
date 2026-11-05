-- Rate limiting de acciones anónimas (2026-07-14): frena el spam de RSVP,
-- aportaciones y waitlist sin depender de servicios externos (Upstash/KV).
-- Se apoya en el propio Postgres: una tabla de "hits" con ventana deslizante
-- y una función que cuenta + inserta. La llaman SOLO las server actions con
-- service role (la tabla no tiene grants para anon/authenticated).

create table if not exists public.rate_limit_hits (
  id bigint generated always as identity primary key,
  bucket_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_hits_bucket_time_idx
  on public.rate_limit_hits (bucket_key, created_at);

alter table public.rate_limit_hits enable row level security;
-- Sin políticas: nadie salvo service_role (que salta RLS). Blindaje explícito.
revoke all on public.rate_limit_hits from anon, authenticated;

-- Devuelve true si la acción se PERMITE (y registra el hit); false si se pasa
-- del límite en la ventana. SECURITY DEFINER + search_path='' por higiene.
create or replace function public.rl_check(
  p_key text,
  p_max int,
  p_window_secs int
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cnt int;
begin
  select count(*) into cnt
  from public.rate_limit_hits
  where bucket_key = p_key
    and created_at > now() - make_interval(secs => p_window_secs);

  if cnt >= p_max then
    return false;
  end if;

  insert into public.rate_limit_hits (bucket_key) values (p_key);
  return true;
end;
$$;

revoke all on function public.rl_check(text, int, int) from public, anon, authenticated;
