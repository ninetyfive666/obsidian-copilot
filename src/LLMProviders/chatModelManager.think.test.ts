import type { CustomModel } from "@/aiParams";
import { ChatModelProviders, ModelCapability } from "@/constants";

import ChatModelManager from "./chatModelManager";

jest.mock("@langchain/ollama", () => {
  class ChatOllama {
    static configs: Array<Record<string, unknown>> = [];
    constructor(config: Record<string, unknown>) {
      ChatOllama.configs.push(config);
    }
  }
  return { ChatOllama };
});

function capturedConfig(): Record<string, unknown> {
  const OllamaMock = jest.requireMock("@langchain/ollama").ChatOllama as {
    configs: Array<Record<string, unknown>>;
  };
  return OllamaMock.configs.at(-1) ?? {};
}

function ollamaModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "qwen3:8b",
    provider: ChatModelProviders.OLLAMA,
    enabled: true,
    apiKey: "default-key",
    capabilities: [ModelCapability.REASONING],
    ...overrides,
  };
}

describe("chatModelManager thinking modes", () => {
  const manager = ChatModelManager.getInstance();

  it("keeps thinking enabled for a reasoning Ollama model in agent mode", async () => {
    await manager.setChatModelFromBridged(ollamaModel());

    expect(capturedConfig().think).toBe(true);
  });

  it("sends think=false to Ollama in plain chat mode", async () => {
    await manager.setChatModelFromBridged(ollamaModel());
    expect(capturedConfig().think).toBe(true);

    manager.getChatModel(false);

    expect(capturedConfig().think).toBe(false);
  });

  it("never sends think=true for a model without the reasoning capability", async () => {
    await manager.setChatModelFromBridged(ollamaModel({ capabilities: [] }));
    expect(capturedConfig().think).toBe(false);

    manager.getChatModel(false);
    expect(capturedConfig().think).toBe(false);
  });

  it("caches one instance per thinking mode", async () => {
    await manager.setChatModelFromBridged(ollamaModel());

    const agentModel = manager.getChatModel();
    const chatModel = manager.getChatModel(false);

    expect(agentModel).not.toBe(chatModel);
    expect(manager.getChatModel()).toBe(agentModel);
    expect(manager.getChatModel(false)).toBe(chatModel);
  });
});
