<h1 align="center">Copilot for Obsidian — local-only</h1>

<p align="center">AI assistant for your Obsidian vault that runs <strong>entirely on your local
LLM servers</strong>. No cloud, no API keys, no accounts, no telemetry.</p>

<p align="center">
  <a href="./local_copilot.md">Local server setup guide</a>
</p>

---

## Supported local servers

Any OpenAI-compatible chat endpoint works:

| Server                                                              | Default base URL            |
| ------------------------------------------------------------------- | --------------------------- |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server`) | `http://localhost:8080/v1`  |
| [Ollama](https://ollama.ai/)                                        | `http://localhost:11434/v1` |
| [LM Studio](https://lmstudio.ai/)                                   | `http://localhost:1234/v1`  |
| Anything else (vLLM, text-generation-webui, …)                      | your own base URL           |

Full step-by-step instructions (context windows, CORS, custom endpoints) live in
[`local_copilot.md`](./local_copilot.md).

## Features

- **Chat** — streaming chat with your local model, markdown-aware rendering, inline citations
  from your vault notes.
- **Agent mode** — the model works with your vault through tools: local note search, reading and
  editing notes, saved memory. Runs entirely against your local server.
- **Vault QA / relevant notes** — lexical search over your notes to ground answers in your own
  documents (offline).
- **Custom commands** — one-click prompts that transform or query your notes.
- **Projects** — scoped system prompts, model choice, and context folders per project.
- **Quick chat** — a fast floating answer box for the active note.

## Getting started

1. Install the plugin (main.js) into your vault and enable it.
2. Start your local server (see the [setup guide](./local_copilot.md)).
3. Open **Copilot → Settings → Models** and click **Add a provider** — pick your server
   (llama.cpp, Ollama, LM Studio, or a custom OpenAI-compatible endpoint). The connection is
   verified right away.
4. Enable at least one model for the **chat** backend and pick your default model.
5. Chat.

## Privacy

This fork makes no network requests at all: no update checks, no analytics, no log uploads,
no model catalogs. Everything runs between Obsidian and your own machine.

## Development

```bash
npm install
npm run build      # typecheck + esbuild
npm run lint       # eslint
npm test           # jest
```

## License

AGPL-3.0, derived from [Logan Yang's Copilot for Obsidian](https://github.com/logancyang/obsidian-copilot).
