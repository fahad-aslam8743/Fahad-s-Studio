# Irfan's Studio — Phase 1 Foundation

Irfan's Studio is an Electron desktop assistant with Next.js UI, Fastify API, Gemini, and Supabase Postgres/pgvector. The repository name is historical; application branding is **Irfan's Studio**.

## Layout
- `apps/desktop`: Electron shell and Windows NSIS configuration.
- `apps/ui`: Next.js statically-exportable holographic UI.
- `services/api`: Gemini-backed streaming chat, voice, tools, memory CRUD.
- `packages/shared`: contracts and validation.
- `services/api/sql/001_init.sql`: Supabase migration.

## Environment
Run on Node.js 22+ with pnpm 10. For local developer setup: `corepack enable`, `pnpm install`, then `cp .env.example services/api/.env`. Fill in `GEMINI_API_KEY`, `DATABASE_URL`, `APP_TOKEN` (a secure 32+ character secret). Execute the SQL migration in Supabase. Never commit actual secrets.

`pnpm dev` launches API, Next.js UI, Electron. Enter APP_TOKEN in Settings before chatting. `pnpm build` builds all workspaces. On Windows run `pnpm --filter @irfan/desktop dist:win` after the UI is built.

## Acceptance checklist
- [ ] Install and build dependencies in a network-enabled CI runner
- [ ] Confirm static Next.js export loads under packaged Electron with all assets
- [ ] Test macOS development and Windows 10/11 NSIS build
- [ ] Test Gemini streaming, multilingual STT/TTS, microphone permissions, interruption
- [ ] Test pgvector storage/retrieval, summaries, and memory edits/deletions
- [ ] Verify audit logging and tool safety flow
- [ ] Verify key secrecy, origin restrictions, auth and prompt injection protections

## Known limitations
**This branch is an unverified Phase 1 implementation, not a production release.** No dependency installation, TypeScript compilation, native Electron launch, or Windows installer test has passed in this environment. The current source needs further fixes for packaged UI asset loading, true native LLM function calling, reliable multilingual voice selection, interruption semantics and robust confirmation execution. The time tool currently uses guarded intent selection. Windows PC control is intentionally absent. Backend runs on loopback by default. Do not expose it publicly without TLS, rate limiting and stronger authorization. Current microphone audio MIME support and Gemini speech output format require live testing.

No client-side LLM API keys are required.
