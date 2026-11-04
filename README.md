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

Defaults live in `src/config.mjs`. Override any of them in `~/.config/jev-relay/config.json`:

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
↪ jev-relay: subagent · sonnet · 0.90
↪ jev-relay: sibling session · sonnet · 0.85
↪ jev-relay: subagent model → haiku
⚠ jev-relay: no classifier answered, using heuristics
```

The number is the classifier's confidence, shown when it reports one.

By default you only see a line when `jev-relay` acts. Set `"report": "every-turn"` in the config to
see one on every prompt, including the ones it skipped:

```
· jev-relay: skipped · 12k tokens, cache warm
· jev-relay: skipped · cooling down (1/3)
· jev-relay: inline · sonnet · 0.80
```

A remote verdict with confidence below `minConfidence` (default `0.6`) is treated as inline: no
nudge and no model pick. Heuristic verdicts are not affected. A value outside 0–1 falls back to the
default.

## Effort

The same classifier call picks a reasoning effort for the turn (`low`, `medium` or `high`). The mod
applies it, along with the model, to inline turns on models that take an effort. The hooks ignore
it. `efforts` lists the levels the classifier may pick and their descriptions. Set `"efforts": {}`
to stop asking, or write your own list, which replaces the default.

## Mod

`hooks/register.tsx` is also a Claude Code mod, so it works anywhere Claude Code loads mods
(terminal, Desktop, VS Code) with no proxy and no `ANTHROPIC_BASE_URL`, and Remote Control keeps
working. Load this repository through `CLAUDE_CODE_PLUGIN_DIRS`.

- Every turn is classified, with no context-size gate. It runs on the model the classifier picks when the verdict is inline. `/model` stops it for that session.
- A subagent verdict adds an instruction to delegate; the picked model applies to the subagent.
- A sibling verdict asks you to approve. Approving runs `claude --bg` (or a background subagent
  where the CLI is unavailable) with your prompt as the brief.

## Band

The band above the prompt shows the latest verdict, for example `jev: inline · haiku · 0.83`, with
a Switch button when the pick differs from the session model. It is off by default:

```bash
jev-relay band on
jev-relay band off
```

## Status notice

The mod prints `jev → haiku · 0.98` in the status area when it picks a model. Turn it off with
`"statusNotice": false` in `~/.config/jev-relay/config.json`. The status line's model slot still
shows the routed model.

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
