import { App, TFile } from "obsidian";
import { ChatModelProviders } from "@/constants";
import { logInfo, logWarn } from "@/logger";
import { configuredModelToCustomModel, type ModelManagementApi } from "@/modelManagement";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { EmbeddingIndexStorage } from "./EmbeddingIndexStorage";
import { LocalEmbeddingClient, type EmbeddingConnection } from "./LocalEmbeddingClient";
import { LocalEmbeddingIndex } from "./LocalEmbeddingIndex";

interface LocalEmbeddingServiceState {
  index: LocalEmbeddingIndex;
  client: LocalEmbeddingClient;
  signature: string;
}

let state: LocalEmbeddingServiceState | null = null;
let initialized = false;
let pendingRefreshes = new Set<string>();
let refreshTimer: number | null = null;
const REFRESH_DEBOUNCE_MS = 1500;

export function initLocalEmbeddings(
  app: App,
  modelManagement: Pick<ModelManagementApi, "providerRegistry">
): void {
  if (initialized) return;
  initialized = true;

  const sync = (): void => {
    void syncNow(app, modelManagement);
  };
  void syncNow(app, modelManagement);
  subscribeToSettingsChange(sync);
  subscribeToVaultEvents(app);
}

export function getLocalEmbeddingService(): LocalEmbeddingServiceState | null {
  return state;
}

export function resetLocalEmbeddingsForTesting(): void {
  stopService();
  initialized = false;
  pendingRefreshes.clear();
  if (refreshTimer) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

async function syncNow(
  app: App,
  modelManagement: Pick<ModelManagementApi, "providerRegistry">
): Promise<void> {
  const settings = getSettings();
  if (!settings.useLocalEmbeddings || !settings.localEmbeddingModelKey) {
    stopService();
    return;
  }

  const connection = await resolveEmbeddingConnection(
    modelManagement,
    settings.localEmbeddingModelKey
  );
  if (!connection) {
    logWarn(
      "LocalEmbeddings: configured embedding model no longer exists; semantic search is off."
    );
    stopService();
    return;
  }

  const signature = `${connection.provider}|${connection.baseUrl}|${connection.model}`;
  if (state && state.signature === signature) return;

  stopService();
  const client = new LocalEmbeddingClient(connection);
  const storage = new EmbeddingIndexStorage(app);
  const index = new LocalEmbeddingIndex(app, client, storage, signature);
  state = { index, client, signature };
  logInfo(`LocalEmbeddings: indexing started with model "${connection.model}"`);
  void index.sync();
}

function stopService(): void {
  if (!state) return;
  state.index.dispose();
  state = null;
}

async function resolveEmbeddingConnection(
  modelManagement: Pick<ModelManagementApi, "providerRegistry">,
  modelKey: string
): Promise<EmbeddingConnection | null> {
  const settings = getSettings();
  const configuredModel = settings.configuredModels.find(
    (model) => model.configuredModelId === modelKey && model.info.isEmbedding
  );
  if (!configuredModel) return null;

  const provider = modelManagement.providerRegistry.get(configuredModel.providerId);
  if (!provider) return null;

  const apiKey = await modelManagement.providerRegistry.getApiKey(provider.providerId);
  const customModel = configuredModelToCustomModel({
    provider,
    configuredModel,
    apiKey,
  });
  if (!customModel.baseUrl) return null;

  return {
    provider: customModel.provider as ChatModelProviders,
    baseUrl: customModel.baseUrl,
    apiKey: customModel.apiKey,
    model: customModel.name,
    enableCors: customModel.enableCors,
  };
}

function subscribeToVaultEvents(app: App): void {
  app.vault.on("modify", (file) => {
    if (file instanceof TFile) scheduleRefresh(app, file.path);
  });
  app.vault.on("delete", (file) => {
    if (file instanceof TFile) void state?.index.removeNote(file.path);
  });
  app.vault.on("rename", (file, oldPath) => {
    if (file instanceof TFile) {
      void state?.index.removeNote(oldPath);
      scheduleRefresh(app, file.path);
    }
  });
}

function scheduleRefresh(app: App, notePath: string): void {
  if (!state || state.index.getStatus() !== "ready") return;
  pendingRefreshes.add(notePath);
  if (refreshTimer) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    const paths = Array.from(pendingRefreshes);
    pendingRefreshes.clear();
    void flushRefreshes(app, paths);
  }, REFRESH_DEBOUNCE_MS);
}

async function flushRefreshes(app: App, notePaths: string[]): Promise<void> {
  if (!state) return;
  for (const notePath of notePaths) {
    if (state.index.getStatus() !== "ready") return;
    const file = app.vault.getAbstractFileByPath(notePath);
    if (file instanceof TFile) {
      try {
        await state.index.refreshNote(file);
      } catch (error) {
        logWarn(`LocalEmbeddings: failed to refresh ${notePath}`, error);
      }
    } else {
      await state.index.removeNote(notePath);
    }
  }
}
