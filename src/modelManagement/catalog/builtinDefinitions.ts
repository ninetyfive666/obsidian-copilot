import type { ProviderDefinition } from "@/modelManagement/types/runtime";

export const LLAMA_CPP_DEFINITION: ProviderDefinition = {
  id: "llama-cpp",
  displayName: "llama.cpp (llama-server)",
  providerType: "openai-compatible",
  defaultBaseUrl: "http://localhost:8080/v1",
  requiresApiKey: false,
  modelInputHint: "e.g. the model id llama-server was started with",
};

export const LOCAL_PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  LLAMA_CPP_DEFINITION,
  {
    id: "ollama",
    displayName: "Ollama",
    providerType: "openai-compatible",
    defaultBaseUrl: "http://localhost:11434/v1",
    requiresApiKey: false,
    modelInputHint: "e.g. llama3.2, qwen2.5-coder:7b",
  },
  {
    id: "lmstudio",
    displayName: "LM Studio",
    providerType: "openai-compatible",
    defaultBaseUrl: "http://localhost:1234/v1",
    requiresApiKey: false,
    modelInputHint: "e.g. lmstudio-community/Qwen2.5-7B-Instruct-GGUF",
  },
];

export const CUSTOM_OPENAI_DEFINITION: ProviderDefinition = {
  id: "custom-openai-compatible",
  displayName: "Custom OpenAI-compatible",
  providerType: "openai-compatible",
  requiresApiKey: false,
  modelInputHint: "e.g. the model id your server exposes",
};

const EMBEDDING_TOKEN = /(^|[-_/.\s])embed(ding)?($|[-_/.\s])/i;

export function looksLikeEmbeddingModel(idOrHaystack: string): boolean {
  return EMBEDDING_TOKEN.test(idOrHaystack);
}
