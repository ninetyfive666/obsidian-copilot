import type { ProviderType } from "@/modelManagement/types/catalog";
import type { ListModelsResult } from "./listOpenAICompatibleModels";
import { listOpenAICompatibleModels } from "./listOpenAICompatibleModels";

export interface ListProviderModelsOptions {
  apiKey?: string | null;
  extras?: Record<string, unknown>;
  timeoutMs?: number;
}

export async function listProviderModels(
  providerType: ProviderType,
  baseUrl: string,
  opts: ListProviderModelsOptions = {}
): Promise<ListModelsResult> {
  const openAIOrgId =
    typeof opts.extras?.openAIOrgId === "string" ? opts.extras.openAIOrgId : undefined;
  return listOpenAICompatibleModels(baseUrl, {
    apiKey: opts.apiKey,
    openAIOrgId,
    timeoutMs: opts.timeoutMs,
  });
}
