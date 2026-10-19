import { CustomModel, getModelKey } from "@/aiParams";
import {
  BUILTIN_CHAT_MODELS,
  ChatModelProviders,
  DEFAULT_OLLAMA_NUM_CTX,
  ModelCapability,
} from "@/constants";
import { logError, logInfo, logWarn } from "@/logger";
import { getModelKeyFromModel, getSettings, subscribeToSettingsChange } from "@/settings/model";
import { safeFetchNoThrow } from "@/utils";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { MissingApiKeyError } from "@/error";
import { ChatLMStudio } from "./ChatLMStudio";

(
  BaseLanguageModel.prototype as { getNumTokens: (...args: unknown[]) => Promise<number> }
).getNumTokens = async (content: string | Array<{ type: string; text?: string }>) => {
  const text =
    typeof content === "string"
      ? content
      : content.map((item: { type: string; text?: string }): string => item.text ?? "").join("");
  return Math.ceil(text.length / 4);
};

type ChatConstructorType = {
  new (config: Record<string, unknown>): BaseChatModel;
};

const CHAT_PROVIDER_CONSTRUCTORS: Record<string, ChatConstructorType | undefined> = {
  [ChatModelProviders.OLLAMA]: ChatOllama,
  [ChatModelProviders.LM_STUDIO]: ChatLMStudio,
  [ChatModelProviders.OPENAI_FORMAT]: ChatOpenAI,
};

export default class ChatModelManager {
  private static instance: ChatModelManager;
  private static chatModel: BaseChatModel | null;
  private static activeModel: CustomModel | null = null;
  private static modelMap: Record<
    string,
    {
      hasApiKey: boolean;
    }
  >;

  private readonly providerApiKeyMap: Record<ChatModelProviders, () => string> = {
    [ChatModelProviders.OLLAMA]: () => "default-key",
    [ChatModelProviders.LM_STUDIO]: () => "default-key",
    [ChatModelProviders.OPENAI_FORMAT]: () => "default-key",
  } as const;

  private constructor() {
    this.buildModelMap();
    subscribeToSettingsChange(() => {
      this.buildModelMap();
      this.validateCurrentModel();
    });
  }

  static getInstance(): ChatModelManager {
    if (!ChatModelManager.instance) {
      ChatModelManager.instance = new ChatModelManager();
    }
    return ChatModelManager.instance;
  }

  private getModelConfig(customModel: CustomModel): Record<string, unknown> {
    const modelName = customModel.name;
    const maxTokens = customModel.maxTokens;
    const openAIFormatIsKeyless = customModel.requiresApiKey === false && !customModel.apiKey;

    // No temperature is sent: local runtimes disagree on accepted values.
    // https://github.com/logancyang/obsidian-copilot/issues/2959
    const baseConfig: Record<string, unknown> = {
      modelName: modelName,
      streaming: customModel.stream ?? true,
      maxRetries: 3,
      maxConcurrency: 3,
      enableCors: customModel.enableCors,
      ...(maxTokens === undefined ? {} : { maxTokens }),
    };

    if ((customModel.provider as ChatModelProviders) === ChatModelProviders.OLLAMA) {
      return {
        ...baseConfig,
        model: modelName,
        baseUrl: customModel.baseUrl || "http://localhost:11434",
        headers: {
          Authorization: `Bearer ${customModel.apiKey || "default-key"}`,
        },
        fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
        think: customModel.capabilities?.includes(ModelCapability.REASONING) ?? false,
        repeatPenalty: 1.1,
        numCtx: customModel.numCtx ?? DEFAULT_OLLAMA_NUM_CTX,
      };
    }

    if ((customModel.provider as ChatModelProviders) === ChatModelProviders.LM_STUDIO) {
      return {
        ...baseConfig,
        modelName,
        apiKey: customModel.apiKey || "default-key",
        streamUsage: customModel.streamUsage ?? false,
        configuration: {
          baseURL: customModel.baseUrl || "http://localhost:1234/v1",
          fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
        },
      };
    }

    return {
      ...baseConfig,
      modelName,
      apiKey: openAIFormatIsKeyless ? "keyless-endpoint" : customModel.apiKey || "",
      streamUsage: customModel.streamUsage ?? false,
      configuration: {
        baseURL: customModel.baseUrl,
        // LangChain drops null default headers, so strip the keyless placeholder after SDK auth and before either transport sends it.
        // https://github.com/logancyang/obsidian-copilot/issues/2946
        fetch: openAIFormatIsKeyless
          ? (url: string, options?: RequestInit) => {
              const headers = new Headers(options?.headers);
              headers.delete("authorization");
              return customModel.enableCors
                ? safeFetchNoThrow(url, { ...options, headers })
                : window.fetch(url, { ...options, headers });
            }
          : customModel.enableCors
            ? safeFetchNoThrow
            : undefined,
      },
    };
  }

  public buildModelMap() {
    const activeModels = getSettings().activeModels;
    ChatModelManager.modelMap = {};
    const modelMap = ChatModelManager.modelMap;

    const allModels = activeModels ?? BUILTIN_CHAT_MODELS;

    allModels.forEach((model) => {
      if (model.enabled) {
        if (!Object.values(ChatModelProviders).includes(model.provider as ChatModelProviders)) {
          logWarn(`Unknown provider: ${model.provider} for model: ${model.name}`);
          return;
        }

        const hasCredentials = this.hasProviderCredentials(model);
        const modelKey = getModelKeyFromModel(model);
        modelMap[modelKey] = {
          hasApiKey: hasCredentials,
        };
      }
    });
  }

  private hasProviderCredentials(model: CustomModel): boolean {
    if (
      model.requiresApiKey === false &&
      (model.provider as ChatModelProviders) === ChatModelProviders.OPENAI_FORMAT
    ) {
      return true;
    }

    return Boolean(model.apiKey);
  }

  getProviderConstructor(model: CustomModel): ChatConstructorType {
    const constructor = CHAT_PROVIDER_CONSTRUCTORS[model.provider];
    if (!constructor) {
      logWarn(`Unknown provider: ${model.provider} for model: ${model.name}`);
      throw new Error(`Unknown provider: ${model.provider} for model: ${model.name}`);
    }
    return constructor;
  }

  getChatModel(): BaseChatModel {
    if (!ChatModelManager.chatModel) {
      throw new Error("No valid chat model available. Please check your model settings.");
    }
    return ChatModelManager.chatModel;
  }

  getActiveModel(): CustomModel | null {
    return ChatModelManager.activeModel;
  }

  async setChatModelFromBridged(model: CustomModel): Promise<void> {
    try {
      ChatModelManager.chatModel = await this.createModelInstanceFromBridged(model);
      ChatModelManager.activeModel = model;
    } catch (error) {
      logError(error);
      throw error;
    }
  }

  async createModelInstanceFromBridged(model: CustomModel): Promise<BaseChatModel> {
    if (!this.hasProviderCredentials(model)) {
      throw new MissingApiKeyError(`API key is not provided for the model: ${model.name}.`);
    }

    const constructorConfig = this.getModelConfig(model);
    const Constructor = this.getProviderConstructor(model);
    return new Constructor(constructorConfig);
  }

  validateChatModel(chatModel: BaseChatModel): boolean {
    if (chatModel === undefined || chatModel === null) {
      return false;
    }
    return true;
  }

  private estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  async countTokens(inputStr: string): Promise<number> {
    return ChatModelManager.chatModel?.getNumTokens(inputStr) ?? this.estimateTokens(inputStr);
  }

  private validateCurrentModel(): void {
    if (!ChatModelManager.chatModel) return;

    const currentModelKey = getModelKey();
    if (!currentModelKey) return;

    const selectedModel = ChatModelManager.modelMap[currentModelKey];

    if (selectedModel && !selectedModel.hasApiKey) {
      ChatModelManager.chatModel = null;
      ChatModelManager.activeModel = null;
      logInfo("Failed to reinitialize model due to missing API key");
    }
  }

  findModelByName(modelName: string): CustomModel | undefined {
    if (ChatModelManager.activeModel?.name === modelName) {
      return ChatModelManager.activeModel;
    }
    const settings = getSettings();
    return settings.activeModels.find((model) => model.name === modelName);
  }
}
