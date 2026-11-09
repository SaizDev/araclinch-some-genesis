---
name: harness
description: Inspect or adapt the development harness - show status, run the doctor, enable or disable single modules (agents, guards, MCP servers, plugins, skills, CI workflows), change the agent model preset, or explain a hook decision. Use when the human wants to reduce, extend or understand the harness.
argument-hint: [status | doctor | modules | enable <module> | disable <module> | why <hook message>]
allowed-tools: Bash(node .claude/harness/harness.mjs status*), Bash(node .claude/harness/harness.mjs doctor*), Bash(node .claude/harness/harness.mjs modules*), Bash(node .claude/harness/harness.mjs ownership *)
---

# /harness

Request: $ARGUMENTS

!`node .claude/harness/harness.mjs status 2>&1 || true`

## Profile
This project runs only the budget profile; there is nothing to switch. Team: product-manager and solution-architect on Opus; backend, frontend, media, ai-agent, integrations, platform engineers and security-auditor on Sonnet. Integrations: supabase (dev, prod, release), context7, typescript-lsp, no GitHub Actions. Token cost grows with each subagent, since each starts from zero.

## Steps
1. **Status, doctor, modules:** run `node .claude/harness/harness.mjs <status|doctor|modules>` and explain the result in plain words.
2. **Changes** (enable, disable): explain the effect first (which agents, guards, servers and plugins change), confirm with the human (AskUserQuestion), then run `node .claude/harness/harness.mjs <command>`. The command asks for permission; that is expected.
   - After enabling a plugin or vendored skill, also run `node .claude/harness/harness.mjs plugins install` or `skills install`.
   - Tell the human to restart the Claude Code session (agents, skills, plugins and MCP servers reload at startup).
3. **Why was I blocked?** Identify the check from the `[harness:<check>]` prefix, explain the rule and its purpose (`.claude/harness/README.md`), and show the compliant path. For ownership questions use `node .claude/harness/harness.mjs ownership check <agent|main> <path>`.
4. **Temporary escape hatches** exist only for the human, set when launching Claude Code, for example `HARNESS_SPEC_GATE=warn claude`, `HARNESS_REVIEW_GATE=off claude` or `HARNESS_DISABLE=format,notify claude`. Mention them only when the human asks how to bypass a guard, and state the risk.
