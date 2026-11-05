# jev-relayer

Per-task Jev routing for Claude Code and Codex. On each prompt it decides whether the work should
run inline, in a subagent or in a sibling session, and it picks the subagent model.

Started from [psadventure/jev-model-router](https://github.com/psadventure/jev-model-router)
(MIT). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## How it works

- `hooks/prompt-submit.mjs` runs on `UserPromptSubmit`. It reads the transcript for context size
  and cache age, and stays silent unless the context is large (100k tokens) or the cache is cold.
  Otherwise it asks a classifier and injects one line of advice. It never blocks a prompt.
- `hooks/agent-model.mjs` runs on `PreToolUse` for `Agent` (Claude only) and sets the subagent
  model unless one was given.
- A sibling verdict tells the model to write a handoff brief, show it to you, and run
  `claude --bg` (or `codex exec`) after you approve.

## When it classifies

The hook skips a prompt unless the conversation is large (`gate.contextTokens`, 100k), the cache
is cold on a context of at least `gate.coldMinTokens` (20k), or the prompt looks heavy and the
context is at least `gate.heavyFloorTokens` (40k). A heavy prompt is one that matches a regex in
`gate.heavyPatterns`: by default fan-out slash commands such as `/peer-review-pr` and `/deep-plan`,
and phrases such as "audit the whole repo". A list you write replaces the default list.

## Classifier chains

Each repo class tries its providers in order and uses the first that answers.

| Repo class | Default chain |
| --- | --- |
| personal (origin matches `personalRemotePatterns`) | `jev`, `heuristics` |
| work (everything else, including no remote) | `qwen-pc`, `qwen`, `heuristics` |

Providers: `jev` (OpenRouter or TypeSafe), `ollama`, `openai-compat`, `heuristics`. Work repos
never reach a remote provider, and a redaction hit in a personal repo drops the remote provider
for that prompt. Tool results are never sent; only prompts and assistant prose.

If every classifier fails, the hook says so once per session and falls back to heuristics.

## Config

Defaults live in `src/config.mjs`. Override any of them in `~/.config/jev-relayer/config.json`:

```json
{ "chains": { "work": ["qwen", "heuristics"] }, "redact": { "names": ["Acme"] } }
```

`models` lists the models the classifier may pick, with a separate list for each agent. Write a
list of names, from weakest to strongest. Known models borrow their built-in description, which the
classifier reads to choose. Delete a name to disallow it. A list you write replaces that agent's
default list, so name every model you want to keep.

```json
{ "models": { "claude": ["haiku", "sonnet"], "codex": ["gpt-6-luna"] } }
```

A model the built-ins don't know needs a description, so write that agent's list as an object:
`{ "gpt-x": "what it is good for" }`.

Defaults: Claude allows `haiku`, `sonnet` and `opus`; Codex allows `gpt-6-luna`, `gpt-6.1-terra` and
`gpt-6.1-sol`. If the classifier answers with a model that is not on the list, that provider's answer
is rejected and the next provider in the chain runs. An agent with an empty list gets no model
question. The sibling nudge carries the chosen model: `claude --bg --model <name>` or
`codex exec -m <name>`.

Keys come from the environment or `~/.config/jev-opus/.env`: `OPENROUTER_API_KEY`,
`TYPESAFE_API_KEY` or `JEV_API_KEY`.

## Feedback

Each nudge and each subagent model pick also prints one line to you through the hook's
`systemMessage` field. The model sees the full advice, and you see this:

```
↪ jev-relayer: subagent · sonnet · 0.90
↪ jev-relayer: sibling session · sonnet · 0.85
↪ jev-relayer: subagent model → haiku
⚠ jev-relayer: no classifier answered, using heuristics
```

The number is the classifier's confidence, shown when it reports one.

By default you only see a line when `jev-relayer` acts, including when an inline verdict switches the model. Set `"report": "every-turn"` in the config to
see one on every prompt, including the ones it skipped:

```
· jev-relayer: skipped · 12k tokens, cache warm
· jev-relayer: skipped · cooling down (1/3)
· jev-relayer: inline · sonnet · 0.80
```

A remote verdict with confidence below `minConfidence` (default `0.6`) is treated as inline: no
nudge and no model pick. Heuristic verdicts are not affected. A value outside 0–1 falls back to the
default.

A sibling verdict (background session) needs more: confidence of at least `siblingMinConfidence` (default
`0.85`), or it is treated as inline. The first prompt of a session never gets a sibling verdict.

Set `"macNotifications": true` to also get a native macOS notification whenever `jev-relayer` acts or the
decision changes (the same moments as the default `changes` reporting). It is off by default.

## Effort

The same classifier call picks a reasoning effort for the turn (`low`, `medium`, `high` or `xhigh`). The mod
applies it, along with the model, to inline turns on models that take an effort. The hooks ignore
it. `efforts` lists the levels the classifier may pick and their descriptions. Set `"efforts": {}`
to stop asking, or write your own list, which replaces the default. Keys must be `low`, `medium`,
`high` or `xhigh`; the mod ignores any other level.

## Mod

`hooks/register.tsx` is also a Claude Code mod, so it works anywhere Claude Code loads mods
(terminal, Desktop, VS Code) with no proxy and no `ANTHROPIC_BASE_URL`, and Remote Control keeps
working. Load this repository through `CLAUDE_CODE_PLUGIN_DIRS`.

- Every turn is classified, with no context-size gate. It runs on the model the classifier picks when the verdict is inline. `/model` stops it for that session.
- A subagent verdict adds an instruction to delegate; the picked model applies to the subagent.
- A sibling verdict asks you to approve. Approving runs `claude --bg` (or a background subagent
  where the CLI is unavailable) with your prompt as the brief.

## Tool profiles

A profile limits the tools a sibling session starts with, so it loads fewer tool schemas and MCP
server instructions. In a test with `claude -p` on haiku, `--strict-mcp-config` plus
`--tools Read,Grep,Glob,Bash` cut the starting input from 37.5k to 16.2k tokens.

Define profiles in `~/.config/jev-relayer/config.json`. See `config.example.json`.

```json
"profiles": {
  "lean": { "description": "Read-only search and summaries.", "claude": { "tools": ["Read", "Grep", "Glob", "Bash"] } },
  "work": { "description": "Needs Linear or Harvest.", "claude": { "mcpConfig": "~/.config/jev-relayer/mcp-work.json", "tools": ["Read", "Bash", "Edit"] } }
}
```

The classifier reads each `description` and picks one. For a Claude sibling, jev-relayer adds
`--strict-mcp-config`, `--mcp-config <file>` when `mcpConfig` is set, and `--tools <list>`. With no
`profiles` key, nothing changes. Profiles apply to Claude siblings only. Subagents are not covered yet.

## Band

The band above the prompt shows the latest verdict, for example `jev: inline · haiku · 0.83`, with
a Switch button when the pick differs from the session model. It is off by default:

```bash
jev-relayer band on
jev-relayer band off
```

## Status notice

The mod prints `jev → haiku · 0.98` in the status area when it picks a model. Turn it off with
`"statusNotice": false` in `~/.config/jev-relayer/config.json`. The status line's model slot still
shows the routed model.

## Toggle

```bash
jev-relayer status
jev-relayer off codex
jev-relayer on all
```

`JEV_RELAYER=off` disables everything for one process. The old name `jev-relay` still works for `JEV_RELAY=off`. The first run moves `~/.config/jev-relay` and `~/.local/state/jev-relay` to the `jev-relayer` names without overwriting newer files.

## Install

- Claude Code: load this directory as a plugin (`CLAUDE_CODE_PLUGIN_DIRS`). The plugin registers
  the `Agent` model hook.
- The prompt hook is registered for both agents through tackroom (`hooks:` in `tackroom.yaml`),
  running `node hooks/prompt-submit.mjs claude` or `... codex`.

## Develop

```bash
npm test
```

## Metrics

Both paths write JSONL events with no prompt text, only lengths. The hooks append to
`~/.local/state/jev-relayer/relay.log`. The mod writes one file per session under
`~/.local/state/jev-relayer/mod/`.

| Event | Source | Records |
| --- | --- | --- |
| `prompt` / `decision` | hook / mod | provider, verdict, raw verdict behind a low-confidence override, latency, failures with timings, redaction hits, whether it nudged |
| `skip` | hook | gate or cooldown reason, context size |
| `agent` / `spawn-model` | hook / mod | subagent model pick and its source (`classifier`, `cached`, `explicit`) |
| `applied` | mod | model and effort applied, the model that served the turn, whether it matches the pick, token usage |
| `action` | mod | subagent spawned, sibling accepted, declined or failed |
| `manual` | mod | you changed the model yourself, which stops routing for the session |
| `deadline-miss` | mod | the classifier answered too late to affect the turn |

```bash
jev-relayer stats              # everything
jev-relayer stats --days 7     # last week
jev-relayer stats --json       # machine-readable
```

Read the report as a checklist:

- **Heuristic fallback and failures**: a high rate means a classifier is down or too slow.
- **Latency p95 and deadline misses**: verdicts that arrive late never apply.
- **Confidence buckets and low-confidence rate**: too many verdicts under `minConfidence` means the threshold or the classifier needs work. Each low-confidence log entry carries the first 200 characters of the prompt, with `redact.names` applied, so you can read what the classifier struggled with.
- **Manual overrides and sibling acceptance**: you rejecting the router is the clearest wrong signal.
- **Served ≠ picked**: the router asked for one model and another answered.
- **Gate skip rate**: how often the gate hides turns the router could have helped.
