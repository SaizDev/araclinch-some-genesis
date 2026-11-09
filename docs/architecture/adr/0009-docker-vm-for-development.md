---
status: accepted
date: 2026-11-09
deciders: Ernesto (owner)
---

# 0009: Workers run in Docker on a development VM

## Context
The workers need Chromium, FFmpeg, fonts and WhisperX. Installing them on the Mac would make local runs differ from Fly. The owner has a Debian VM with Docker, reachable over SSH from the internet.

## Decision
- Claude Code runs on the Mac. Docker commands go to the VM through one Docker context (`araclinch-vm`, set as `DOCKER_CONTEXT` in `.claude/settings.json`, recorded in `stack.docker.context`).
- `compose.dev.yaml` (platform-engineer) builds the worker images from the same Dockerfiles Fly uses and runs them against the development Supabase project. Environment comes from `.env.local` on the Mac through `env_file`.
- No bind mounts (a host path would resolve on the VM), no Postgres container, no published ports except on `127.0.0.1`, no privileged or host-namespace containers, no Docker socket. Hooks enforce it, in commands and in compose files.
- Agents may build, start, stop and read logs. Contexts, registry logins and pushes are human-only. Commands that print container environments are blocked, since they hold development secrets.
- The web app runs on the Mac (`pnpm dev`). The `-dev` Fly apps stay available as a final check (`fly deploy --build-only` builds without releasing).

## Consequences
- Positive: development images equal production images; nothing heavy on the Mac.
- Negative: every change rebuilds the image (no hot reload through bind mounts); tests depend on the VM being up and the SSH key being loaded.
- Security: Docker access is root on the VM, and container settings on the VM hold the development secrets, so the VM is single-user and key-only.
