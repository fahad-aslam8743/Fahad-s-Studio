# Phase 4: Video Studio — local FFmpeg and paid fal.ai

## Architecture and cost model
- LocalEngine (apps/desktop/src/video-engine.ts) executes on the Windows Electron main process, behind the consent-gated local IPC bridge. All processes run with spawn(command, argumentArray, shell:false), not shell-assembled strings. Mac returns explicit MOCK objects. Output must differ from the source file; FFmpeg runs in a disposable temporary folder with no overwrite.
- FalEngine (services/worker/src/video.js) uses the official @fal-ai/client 1.10.1 on the authenticated Cloudflare backend. FAL_KEY only exists as a backend Runtime Secret; it never reaches Electron preload or React.
- Fal model IDs, valid durations and estimated prices are in services/worker/src/video-models.js. Current defaults: wan/v2.6/text-to-video and wan/v2.6/image-to-video, 5/10/15 seconds, 720p/1080p. UI estimate uses 0.10 USD/s at 720p and 0.15 USD/s at 1080p, according to October 2026 model pages. **Provider price can change; estimates are NOT quotes.**
- AI director rewrites an idea into a structured prompt: subject, action, shotType, lens, cameraMovement, lighting, colorGrade, mood, styleReferences, duration, aspectRatio, negativePrompt. User edits/approves before paid submission.
- Paid flow: draft → server-side computed preview and estimate → user CONFIRM → one-time atomic job transition → official fal queue.submit → /video/status queue.status, queue.result → preview and open/download media. Supabase stores job and estimated usage history.
- Default daily estimated-cost cap $5 USD via FAL_DAILY_LIMIT_USD. Safety is approximate: concurrency, queue retries, failed jobs, fal price changes and external account usage may cause real billing differences. Do not treat it as a hard provider spending limit. Set separate spending controls on fal.ai itself.

## Owner setup
1. Visit https://fal.ai/ and create/sign in to the user's fal.ai account. Create an API key from fal dashboard; fal can bill per generation, so check credits and payment methods before enabling.
2. Cloudflare Worker → Settings → Runtime variables and secrets: FAL_KEY = Secret, FAL_DAILY_LIMIT_USD = Plaintext e.g. 5. Never put FAL_KEY in Build environment, GitHub or client UI. FAL_KEY is optional; free LocalEngine functions without it.
3. Save and deploy AFTER promotion of this branch. In Jarvis open Video Studio, choose Free local or fal.ai paid; active engine stays visible. The spoken commands "use free local tools" / "use fal AI" change active mode but NEVER submit paid jobs.
4. For local Windows editing, click Install FFmpeg through Windows Package Manager (explicit confirmation). This runs winget.exe install --id Gyan.FFmpeg --exact --accept-package-agreements --accept-source-agreements using a fixed argv array; winget validates package manifests/hashes and may require user/administrator interaction. Windows 10/11 requires working winget. Restart Jarvis if FFmpeg isn't immediately on PATH. Official download page: https://ffmpeg.org/download.html .
5. For automatic subtitles install the official whisper.cpp Windows CLI and a ggml Whisper model from a trusted source, then provide absolute model path in the edit plan. The engine normalizes media to 16 kHz PCM and calls whisper-cli with -osrt to generate an SRT, then burns subtitles. This is an optional local dependency and NOT yet automatically installed; the source download/model integrity must be separately verified. https://github.com/ggml-org/whisper.cpp
6. Only use stock video/music/fonts whose licenses authorize the intended use.

## Local FFmpeg operations and manual checklist
- [ ] Trim and cut test clip to precise timestamp interval; reject end before start.
- [ ] Merge two clips and check output; currently audio tracks are dropped when concatenating.
- [ ] Crop pixel dimensions and resize frames; inspect quality and even dimensions.
- [ ] 9:16, 16:9, 1:1, 4:5 aspect crops; compare with intended composition.
- [ ] Speed 0.5x / 1.5x / 2x, check audio pitch quality and synchronization.
- [ ] Mix supplied background music; requires existing input audio track.
- [ ] Normalize speech/dialogue with FFmpeg loudnorm.
- [ ] Burn manual .srt subtitles; auto-generate .srt with installed whisper-cli and model.
- [ ] Text overlay positioning and font availability; attempt Unicode/RTL text.
- [ ] Fade in/out; crossfade between two videos (audio currently dropped in crossfade).
- [ ] Color/filter presets cinematic/warm/cool/vintage/grayscale/vivid.
- [ ] Export YouTube 1920x1080 and Shorts/Reels/TikTok 1080x1920.
- [ ] DENY a video render / FFmpeg install and confirm it didn't execute.
- [ ] Test input file missing, output equal input, output path not writable and FFmpeg missing.
- [ ] On a Mac developer machine, verify fake/mock result and zero host mutation.

## fal.ai and AI director manual checklist
- [ ] With FAL_KEY absent, local mode works, paid mode reports disabled.
- [ ] AI director produces editable structured shot brief for "a car chase at night"; user can revise before preparation.
- [ ] Prepare text-to-video and image-to-video, verify valid image URL and allowed 5/10/15 durations.
- [ ] Review model, fully expanded prompt, negative prompt, duration/resolution and USD estimate. DENY before any queue submission.
- [ ] Approve one paid generation; verify exactly one queue request and job history, then poll status until result video URL.
- [ ] Reconfirm same job, confirm unknown ID, exceed daily cap, test fal API outage and queue errors.
- [ ] Click open/download and save the resulting MP4 via default browser.
- [ ] Request edit in plain English. Model must propose JSON plan; user reviews/edit fields and approves before local FFmpeg execution.

## Known limitations
- Actual Windows GPU/CPU performance and all FFmpeg operations require real Windows testing.
- Merging clips now normalizes video frames and fills missing audio with silence. Two audio-equipped clips can crossfade sound; a transition containing a mute clip outputs silent video for that transition. The music mixer supports both audio-equipped and mute source videos. Fancy motion graphics, keyframed VFX, template-driven cuts, native stock asset retrieval, scene detection and production-grade professional storytelling are not yet implemented and require additional work.
- Whisper.cpp executable/model must be installed separately; large Whisper models are NOT bundled; some 2026 Windows binaries have reported path/BLAS issues. No assurance that every language transcribes cleanly.
- Model response fields, endpoint parameter values, prices and video availability can change on fal.ai. The chosen Wan 2.6 model parameters have been checked but should be verified again before a paid release.
- The queue uses automatic UI polling (every five seconds); webhooks not enabled. A Worker interruption after queue submission but before persisting request_id can leave job in "submitting" (requires operator reconciliation). Daily model-cost estimates are now reserved transactionally in Supabase at approval time, preventing two simultaneous approvals from exceeding the configured estimated limit. It is not a provider-level hard ceiling because model prices/actual billing can differ and separate fal account usage isn't counted.
- DaVinci Resolve is NOT integrated. In DaVinci Resolve 21.1 (September 2026), Python scripting was moved to the **paid Studio** edition and scripting support in Free is substantially reduced; automating the free edition from an external Jarvis agent is not reliably supported. We will not build a Resolve adapter unless the owner separately approves paid Studio dependency. Source: https://www.pugetsystems.com/blog/2026/09/10/how-davinci-resolve-free-v21-1-scripting-changes-affect-puget-bench/ .
- The active production Worker still points at the earlier branch; Phase 4 code is on phase-3-4-email-video and remains subject to CI and Windows acceptance.

## Source
apps/desktop/src/video-engine.ts, apps/desktop/src/local-agent.ts, apps/desktop/src/preload.ts, apps/ui/components/VideoPanel.tsx, apps/ui/app/page.tsx, services/worker/src/video.js, services/worker/src/video-models.js, supabase/migrations/20261019_phase3_4.sql.
