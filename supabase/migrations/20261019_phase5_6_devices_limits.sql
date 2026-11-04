-- Applied in the Irfan's Studio Supabase project (2026-10-19).
create table if not exists public.jarvis_device_pairs (
 code_hash text primary key,
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create table if not exists public.jarvis_devices (
 id uuid primary key default gen_random_uuid(), label text not null,
 platform text not null check(platform in ('android','windows')),
 token_hash text not null unique, created_at timestamptz not null default now(),
 last_seen_at timestamptz, revoked_at timestamptz
);
create table if not exists public.jarvis_remote_tasks (
 id uuid primary key default gen_random_uuid(),
 source_device uuid references public.jarvis_devices(id),
 target text not null, tool text not null,
 args jsonb not null default '{}'::jsonb,
 status text not null default 'pending', result jsonb,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default(now()+interval '5 minutes')
);
create table if not exists public.jarvis_api_rate (
 subject_hash text not null, bucket timestamptz not null,
 count integer not null default 0,
 primary key(subject_hash,bucket)
);
create index if not exists jarvis_remote_pending_idx on public.jarvis_remote_tasks(target,status,expires_at);
do $$ declare t text;
begin foreach t in array array['jarvis_device_pairs','jarvis_devices','jarvis_remote_tasks','jarvis_api_rate'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select,insert,update,delete on public.%I to service_role',t);
end loop;end $$;
create or replace function public.jarvis_rate_check(p_subject text,p_limit integer)
returns boolean language plpgsql security invoker set search_path=public as $$
declare v_count integer;
begin
 if length(p_subject)>120 or p_limit<1 or p_limit>10000 then return false;end if;
 insert into public.jarvis_api_rate(subject_hash,bucket,count)
 values(p_subject,date_trunc('minute',now()),1)
 on conflict(subject_hash,bucket) do update set count=jarvis_api_rate.count+1
 returning count into v_count;
 return v_count <= p_limit;
end $$;
revoke execute on function public.jarvis_rate_check(text,integer) from public,anon,authenticated;
grant execute on function public.jarvis_rate_check(text,integer) to service_role;
create or replace function public.jarvis_daily_ai_check(p_subject text,p_limit integer)
returns boolean language plpgsql security invoker set search_path=public as $$
declare counted integer;
begin
 if p_subject is null or length(p_subject)>120 or p_limit<1 or p_limit>100000 then return false;end if;
 insert into public.jarvis_api_rate(subject_hash,bucket,count)
 values(p_subject,date_trunc('day',now()),1)
 on conflict(subject_hash,bucket) do update set count=jarvis_api_rate.count+1
 returning count into counted;
 return counted<=p_limit;
end $$;
revoke execute on function public.jarvis_daily_ai_check(text,integer) from public,anon,authenticated;
grant execute on function public.jarvis_daily_ai_check(text,integer) to service_role;
