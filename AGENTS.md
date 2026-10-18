# AGENTS.md

This file provides guidance to any coding agent when working with code in this repository.

## Overview

This is a **local-only fork** of [Copilot for Obsidian](https://github.com/logancyang/obsidian-copilot).
The plugin is an AI assistant for Obsidian that runs **exclusively against local LLM servers**
(llama.cpp llama-server, Ollama, LM Studio, any OpenAI-compatible endpoint). There is no cloud,
no API-key marketplace, no licensing, no update checks, and no external network access by design.
Keep it that way: do not reintroduce remote model providers, accounts, or third-party services.

## Commands

- **NEVER RUN `npm run dev`**.
- `npm run build` — production build (TypeScript check + minified output).
- `npm run lint` / `npm run lint:fix` — ESLint check / autofix.
- `npm run format` / `npm run format:check` — Prettier write / check.
- **Before committing: always run `npm run format && npm run lint && npm test`.**
- `npm run test` — unit tests. Single test: `npm test -- -t "test name"`.
- `npm run test:vault` — macOS-only build-and-deploy into `$COPILOT_TEST_VAULT_PATH`; see [`TESTING_GUIDE.md`](./designdocs/agents/TESTING_GUIDE.md).

## Core principles (apply to every change)

- **Local-only invariant.** All model traffic must go to user-configured local endpoints
  (`settings.providers` → openai-compatible). No new `fetch`/`requestUrl` to external hosts.
- **Always write generalizable solutions.** No hardcoded folder names, file patterns, or
  special-case logic (no "piano notes" / "daily notes" branches). Make varying behavior
  configurable, not hardcoded.
- **Never modify AI prompt content** — system prompts, model adapter prompts, etc. — unless the
  user explicitly asks.
- **Use stories for user-visible React work.** When a feature adds or changes a component or a
  meaningful visual state, add or update its adjacent `*.stories.tsx` file and verify the rendered
  states in the component gallery. Stories complement unit tests; non-visual changes do not
  require one. Follow the [`Component gallery workflow`](./designdocs/agents/TESTING_GUIDE.md#component-gallery-workflow).
- **Referential stability.** Never return a freshly-allocated `[]` / `{}` for an "empty" slice;
  return a frozen module-level constant (canonical examples: `EMPTY_PROVIDERS` /
  `EMPTY_CONFIGURED_MODELS` / `EMPTY_BACKENDS` in `src/settings/model.ts`).
- **Structure unit tests by module, class, and callable.** One top-level `describe("moduleName", ...)`
  per module; one `describe("ClassName", ...)` per class; one nested `describe("methodName()", ...)`
  per method; `it(...)` names state the observable behavior. → [`Test design workflow`](./designdocs/agents/TESTING_GUIDE.md#test-design-workflow)
- **Preserve provenance for new behavioral branches and edge cases.** Include the originating
  GitHub issue's full URL in the nearby comment and the `it(...)` description.
- **Pair every production TypeScript function and method with unit coverage.**
- **Never wait for async work by ticks or timers.** No `setTimeout(…, 0)`, `queueMicrotask`, or
  `await Promise.resolve()` to "let pending work land". Await the work itself.
  → [`Async ordering`](./designdocs/agents/STYLE_GUIDE.md#async-ordering)
- **Never call `console` directly** — use `logInfo()` / `logWarn()` / `logError()` from `@/logger`.
- **Every JavaScript/TypeScript comment links a GitHub issue.** A comment may only record a
  tricky decision tied to a specific issue: the one-line why plus the issue's full URL.
  Everything else is expressed through names, types, and tests. `copilot/issue-linked-comments`
  enforces this in `npm run lint`.
- **Keep React styling in Tailwind.** Static styles on React-owned elements as utilities; reuse a
  shared component when a visual pattern repeats. Never edit `styles.css` (generated); wrap
  composed class strings in `cn()`. → [`STYLE_GUIDE.md`](./designdocs/agents/STYLE_GUIDE.md)
- **TypeScript:** `@/` absolute imports; `interface` for shapes, `type` for unions. **React:**
  custom hooks, props interfaces above components. → [`STYLE_GUIDE.md`](./designdocs/agents/STYLE_GUIDE.md)
- **Never use the global `app`** (footgun in popouts, hides dependencies); thread it via
  `useApp()` or a parameter. → [`PLUGIN_DEV_GUIDE.md`](./designdocs/agents/PLUGIN_DEV_GUIDE.md)

## Task-specific guides

Read the matching guide when your task touches that area — they aren't loaded by default.

| When you're…                                                          | Read                                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| writing or altering tests, or doing E2E via the Obsidian CLI          | [`designdocs/agents/TESTING_GUIDE.md`](./designdocs/agents/TESTING_GUIDE.md)                    |
| building or changing user-visible React components or visual states   | [`Component gallery workflow`](./designdocs/agents/TESTING_GUIDE.md#component-gallery-workflow) |
| writing code: DI/structure, TypeScript, React, comments, CSS/Tailwind | [`designdocs/agents/STYLE_GUIDE.md`](./designdocs/agents/STYLE_GUIDE.md)                        |
| touching plugin runtime: the `app`, network requests, popout windows  | [`designdocs/agents/PLUGIN_DEV_GUIDE.md`](./designdocs/agents/PLUGIN_DEV_GUIDE.md)              |
| running a multi-step dev session                                      | [`designdocs/agents/PROCESS_GUIDE.md`](./designdocs/agents/PROCESS_GUIDE.md)                    |

## Important notes

- The only model path is **openai-compatible**: local server base URL + optional key.
  Provider metadata lives in `src/constants.ts` (`ChatModelProviders`), the model data model in
  `src/modelManagement/` (see [`designdocs/todo/models_management_redesign_cleanup.md`](./designdocs/todo/models_management_redesign_cleanup.md)).
- Settings are versioned — retired cloud fields are stripped by `RETIRED_SETTINGS_FIELDS` in
  `src/settings/model.ts`; keep that list current when removing settings.
- Local server setup (user-facing) is documented in [`local_copilot.md`](./local_copilot.md).
- Available Tailwind tokens/classes → [`tailwind.config.js`](./tailwind.config.js).
