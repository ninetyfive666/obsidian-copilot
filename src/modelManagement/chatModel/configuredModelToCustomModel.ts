import { CustomModel } from "@/aiParams";
import {
  ChatModelProviders,
  ModelCapability,
} from "@/constants";
import { providerNeedsResolvedApiKey } from "@/modelManagement/providers/providerRequiresApiKey";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";

export const CATALOG_ID_TO_CHAT_PROVIDER: Record<string, ChatModelProviders> = {
  ollama: ChatModelProviders.OLLAMA,
  lmstudio: ChatModelProviders.LM_STUDIO,
};

export function mapProviderTypeToChatModelProvider(provider: Provider): ChatModelProviders {
  const catalogId =
    provider.origin.kind === "byok" ? provider.origin.catalogProviderId : undefined;
  return (catalogId && CATALOG_ID_TO_CHAT_PROVIDER[catalogId]) || ChatModelProviders.OPENAI_FORMAT;
}

function extraString(extras: Record<string, unknown>, key: string): string | undefined {
  const value = extras[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function customModelMaxTokens(provider: Provider): number | undefined {
  const value = provider.extras?.maxTokens;
  return typeof value === "number" && value > 0 ? value : undefined;
}

function customModelNumCtx(provider: Provider): number | undefined {
  const value = provider.extras?.numCtx;
  return typeof value === "number" && value > 0 ? value : undefined;
}

export function configuredModelToCustomModel(params: {
  provider: Provider;
  configuredModel: ConfiguredModel;
  apiKey: string | null;
}): CustomModel {
  const { provider, configuredModel, apiKey } = params;
  const info = configuredModel.info;
  const extras = provider.extras ?? {};

  const trimmedKey = apiKey && apiKey.length > 0 ? apiKey : undefined;
  const requiresApiKey = providerNeedsResolvedApiKey(provider) || !!trimmedKey;

  const chatProvider = mapProviderTypeToChatModelProvider(provider);
  const maxTokens = customModelMaxTokens(provider);

  const capabilities: ModelCapability[] = [];
  if (info.reasoning) capabilities.push(ModelCapability.REASONING);
  if (info.modalities?.input?.includes("image")) capabilities.push(ModelCapability.VISION);

  return {
    configuredModelId: configuredModel.configuredModelId,
    name: info.id,
    provider: chatProvider,
    displayName: info.displayName,
    enabled: true,
    baseUrl: provider.baseUrl,
    apiKey: trimmedKey,
    requiresApiKey,
    // https://github.com/logancyang/obsidian-copilot-preview/issues/313:
    // verification can pass through requestUrl while Quick Chat fails through
    // native fetch. Preserve the user's explicit compatibility-versus-streaming
    // choice when bridging the provider into the legacy chat runtime.
    enableCors: provider.enableCors,
    capabilities,
    maxTokens,
    openAIOrgId: extraString(extras, "openAIOrgId"),
    numCtx: customModelNumCtx(provider),
  };
}
