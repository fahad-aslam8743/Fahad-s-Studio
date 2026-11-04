-- Applied to Irfan's Studio Supabase 2026-10-19.
-- Atomic daily USD estimate reservation: protects against concurrent approvals.
create table if not exists public.jarvis_video_daily_budget (
 day date primary key,
 reserved_usd numeric(14,4) not null default 0 check(reserved_usd>=0),
 updated_at timestamptz not null default now()
);
alter table public.jarvis_video_daily_budget enable row level security;
revoke all on public.jarvis_video_daily_budget from anon,authenticated;
grant select,insert,update on public.jarvis_video_daily_budget to service_role;
create or replace function public.reserve_jarvis_video_budget(p_day date,p_limit numeric,p_estimate numeric)
returns boolean language plpgsql security invoker set search_path=public as $$
declare changed integer;
begin
 if p_day is null or p_day <> (now() at time zone 'UTC')::date or p_limit is null or p_estimate is null or p_limit < 0 or p_estimate <= 0 or p_estimate > p_limit then return false; end if;
 insert into public.jarvis_video_daily_budget(day,reserved_usd,updated_at)
 values(p_day,p_estimate,now())
 on conflict(day) do update set reserved_usd=jarvis_video_daily_budget.reserved_usd+excluded.reserved_usd,updated_at=now()
 where jarvis_video_daily_budget.reserved_usd+excluded.reserved_usd<=p_limit;
 get diagnostics changed=row_count;
 return changed=1;
end $$;
revoke execute on function public.reserve_jarvis_video_budget(date,numeric,numeric) from public,anon,authenticated;
grant execute on function public.reserve_jarvis_video_budget(date,numeric,numeric) to service_role;
