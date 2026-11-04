-- Applied to Supabase project iqqszfuyyhagdovfzzqd, 2026-10-19
CREATE TABLE IF NOT EXISTS public.jarvis_oauth_states(state_hash text primary key,verifier_cipher text not null,expires_at timestamptz not null);
CREATE TABLE IF NOT EXISTS public.jarvis_email_accounts(provider text primary key check(provider in ('gmail','outlook')),email_address text not null,refresh_token_cipher text not null,scopes text not null,updated_at timestamptz not null default now());
CREATE TABLE IF NOT EXISTS public.jarvis_email_pending(id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('send','reply','trash')),payload jsonb not null,expires_at timestamptz not null default(now()+ interval '5 minutes'),consumed_at timestamptz);
CREATE INDEX IF NOT EXISTS jarvis_pending_active_idx ON public.jarvis_email_pending(expires_at) WHERE consumed_at IS NULL;
CREATE TABLE IF NOT EXISTS public.jarvis_video_jobs(id uuid primary key default gen_random_uuid(),model_id text not null,request_id text unique,kind text not null check(kind in ('text','image')),status text not null default 'submitted',estimate_usd numeric(12,4) not null,result jsonb,created_at timestamptz not null default now());
CREATE TABLE IF NOT EXISTS public.jarvis_video_usage(id bigint generated always as identity primary key,job_id uuid references public.jarvis_video_jobs(id),event text not null,estimated_usd numeric(12,4) not null,recorded_at timestamptz not null default now());
ALTER TABLE public.jarvis_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_email_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_video_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_video_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jarvis_oauth_states,public.jarvis_email_accounts,public.jarvis_email_pending,public.jarvis_video_jobs,public.jarvis_video_usage FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.jarvis_oauth_states,public.jarvis_email_accounts,public.jarvis_email_pending,public.jarvis_video_jobs,public.jarvis_video_usage TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.jarvis_video_usage_id_seq TO service_role;
