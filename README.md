# jev-relay

Per-task routing for Claude Code and Codex. On each prompt it decides whether the work should
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

Defaults live in `src/config.mjs`. Override any of them in `~/.config/jev-relay/config.json`:

```json
{ "chains": { "work": ["qwen", "heuristics"] }, "redact": { "names": ["Acme"] } }
```

`models` lists the models the classifier may pick per agent. A pick outside the list is clamped to
the nearest allowed model, stepping up before down. An agent with no entry gets no model question.
Each agent has its own list, so Claude and Codex can allow different tiers.

```json
{ "models": { "claude": ["haiku", "sonnet"], "codex": ["haiku", "sonnet", "opus"] } }
```

`tierModels` maps a tier to the model id an agent uses. Codex defaults to `gpt-6-luna`,
`gpt-6.1-terra` and `gpt-6.1-sol`, and the sibling nudge becomes `codex exec -m <model> "<brief>"`.
Override any of them:

```json
{ "tierModels": { "codex": { "opus": "gpt-6.1-sol" } } }
```

Keys come from the environment or `~/.config/jev-opus/.env`: `OPENROUTER_API_KEY`,
`TYPESAFE_API_KEY` or `JEV_API_KEY`.

## Toggle

```bash
jev-relay status
jev-relay off codex
jev-relay on all
```

`JEV_RELAY=off` disables everything for one process.

## Install

- Claude Code: load this directory as a plugin (`CLAUDE_CODE_PLUGIN_DIRS`). The plugin registers
  the `Agent` model hook.
- The prompt hook is registered for both agents through tackroom (`hooks:` in `tackroom.yaml`),
  running `node hooks/prompt-submit.mjs claude` or `... codex`.

## Develop

```bash
npm test
```

Decisions are logged to `~/.local/state/jev-relay/relay.log`.
