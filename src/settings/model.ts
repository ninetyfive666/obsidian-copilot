import { CustomModel, ProjectConfig } from "@/aiParams";
import { getModelKeyFromModel } from "@/lib/model-key";
import { atom, createStore, useAtomValue } from "jotai";

import { ChainType } from "@/chainType";
import type { BackendConfig, BackendType, ConfiguredModel, Provider } from "@/modelManagement";
import { MODEL_SECRET_FIELDS, TOP_LEVEL_SECRET_FIELDS } from "@/services/settingsSecretTransforms";
import { type SortStrategy, isSortStrategy } from "@/utils/recentUsageManager";
import {
  BUILTIN_CHAT_MODELS,
  DEFAULT_OPEN_AREA,
  DEFAULT_QA_EXCLUSIONS_SETTING,
  DEFAULT_SETTINGS,
  SEND_SHORTCUT,
} from "@/constants";

export { getModelKeyFromModel } from "@/lib/model-key";

export interface LegacyCommandSettings {
  name: string;

  modelKey?: string;

  prompt: string;

  showInContextMenu: boolean;
}

export interface CopilotSettings {
  defaultChainType: ChainType;
  defaultModelKey: string;
  contextTurns: number;
  lastDismissedVersion: string | null;
  lastShownStartupVersion: string | null;
  userSystemPrompt: string;
  stream: boolean;
  copilotFolder: string;
  copilotRootHistory: string[];
  upgradedToV8FromLegacy: boolean;
  defaultSaveFolder: string;
  defaultConversationTag: string;
  autosaveChat: boolean;
  autoAddActiveContentToContext: boolean;
  customPromptsFolder: string;
  chatNoteContextPath: string;
  chatNoteContextTags: string[];
  debug: boolean;
  maxSourceChunks: number;
  enableInlineCitations: boolean;
  qaExclusions: string;
  qaInclusions: string;
  activeModels: Array<CustomModel>;
  promptUsageTimestamps: Record<string, number>;
  promptSortStrategy: string;
  chatHistorySortStrategy: SortStrategy;
  projectsFolder: string;
  defaultOpenArea: DEFAULT_OPEN_AREA;
  defaultSendShortcut: SEND_SHORTCUT;
  defaultConversationNoteName: string;
  inlineEditCommands: LegacyCommandSettings[] | undefined;
  projectList: Array<ProjectConfig>;
  passMarkdownImages: boolean;
  enableAutonomousAgent: boolean;
  thinkingInChat: boolean;
  thinkingInAgent: boolean;
  thinkingInCustomCommands: boolean;
  useLocalEmbeddings: boolean;
  localEmbeddingModelKey: string;
  enableCustomPromptTemplating: boolean;
  relevantNotesLiveUpdate: boolean;
  enableLexicalBoosts: boolean;
  lexicalSearchRamLimit: number;
  suggestedDefaultCommands: boolean;
  autonomousAgentEnabledToolIds: string[];
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  verbosity: "low" | "medium" | "high";
  memoryFolderName: string;
  enableRecentConversations: boolean;
  maxRecentConversations: number;
  enableSavedMemory: boolean;
  quickCommandModelKey: string | undefined;
  quickCommandIncludeNoteContext: boolean;
  autoAcceptEdits: boolean;
  diffViewMode: "side-by-side" | "split";
  userSystemPromptsFolder: string;
  defaultSystemPromptTitle: string;
  autoCompactThreshold: number;
  convertedDocOutputFolder: string;
  _keychainVaultId?: string;
  settingsVersion?: number;
  providers: Record<string, Provider>;
  configuredModels: ConfiguredModel[];
  backends: Partial<Record<BackendType, BackendConfig>>;
}

export const settingsStore = createStore();
export const settingsAtom = atom<CopilotSettings>(DEFAULT_SETTINGS);

const EMPTY_PROVIDERS = Object.freeze({}) as unknown as Record<string, Provider>;
const EMPTY_CONFIGURED_MODELS = Object.freeze([]) as unknown as ConfiguredModel[];
const EMPTY_BACKENDS = Object.freeze({}) as unknown as Partial<Record<BackendType, BackendConfig>>;

const EMPTY_COPILOT_ROOT_HISTORY = Object.freeze([]) as unknown as string[];

export function normalizeRootFolders(input: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const normalized = raw
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .split("/")
      .filter((segment) => segment !== ".")
      .join("/")
      .replace(/\/+$/, "");
    if (normalized.length === 0) continue;
    const escapesVault =
      /(^|\/)\.\.(\/|$)/.test(normalized) ||
      /^[a-zA-Z]:/.test(normalized) ||
      normalized.startsWith("/");
    if (escapesVault) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result.length > 0 ? result : EMPTY_COPILOT_ROOT_HISTORY;
}

export function setSettings(
  settings: Partial<CopilotSettings> | ((current: CopilotSettings) => Partial<CopilotSettings>)
) {
  settingsStore.set(settingsAtom, (prev) => {
    const partial = typeof settings === "function" ? settings(prev) : settings;
    return mergeActiveChatModelsWithCoreModels({ ...prev, ...partial });
  });
}

export function sanitizeQaExclusions(rawValue: unknown): string {
  const rawValueString = typeof rawValue === "string" ? rawValue : DEFAULT_QA_EXCLUSIONS_SETTING;

  const decodedPatterns: string[] = rawValueString
    .split(",")
    .map((pattern: string) => decodeURIComponent(pattern.trim()))
    .filter((pattern: string) => pattern.length > 0);

  const canonicalToOriginalPattern = new Map<string, string>();

  decodedPatterns.forEach((pattern) => {
    const canonical = pattern.replace(/\/+$/, "");
    const canonicalKey = canonical.length > 0 ? canonical : pattern;
    if (!canonicalToOriginalPattern.has(canonicalKey)) {
      const normalizedValue =
        canonical.length > 0 && pattern.endsWith("/") ? `${canonical}/` : pattern;
      canonicalToOriginalPattern.set(canonicalKey, normalizedValue);
    }
  });

  return Array.from(canonicalToOriginalPattern.values())
    .map((pattern) => encodeURIComponent(pattern))
    .join(",");
}

export function updateSetting<K extends keyof CopilotSettings>(key: K, value: CopilotSettings[K]) {
  setSettings((cur) => ({ ...cur, [key]: value }));
}

export function getSettings(): Readonly<CopilotSettings> {
  return settingsStore.get(settingsAtom);
}

const MODEL_CREDENTIAL_BUNDLE_FIELDS = [
  ...MODEL_SECRET_FIELDS,
  "baseUrl",
  "enableCors",
] as const satisfies readonly (keyof CustomModel)[];

const TOP_LEVEL_CREDENTIAL_BUNDLE_FIELDS: readonly string[] = [...TOP_LEVEL_SECRET_FIELDS];

function carriesConfiguration(field: string, value: unknown): boolean {
  if (field === "enableCors") return typeof value === "boolean";
  return typeof value === "string" && value.length > 0;
}

function withPreservedModelCredential(defaultModel: CustomModel, source: CustomModel): CustomModel {
  const merged = { ...defaultModel } as unknown as Record<string, unknown>;
  const sourceRecord = source as unknown as Record<string, unknown>;
  for (const field of MODEL_CREDENTIAL_BUNDLE_FIELDS) {
    const value = sourceRecord[field];
    if (carriesConfiguration(field, value)) {
      merged[field] = value;
    }
  }
  return merged as unknown as CustomModel;
}

function preserveModelCredentials(
  defaultModels: CustomModel[],
  currentModels: CustomModel[]
): CustomModel[] {
  const currentByKey = new Map(currentModels.map((model) => [getModelKeyFromModel(model), model]));
  const defaultKeys = new Set(defaultModels.map((model) => getModelKeyFromModel(model)));

  const restoredBuiltIns = defaultModels.map((defaultModel) => {
    const previous = currentByKey.get(getModelKeyFromModel(defaultModel));
    return previous ? withPreservedModelCredential(defaultModel, previous) : defaultModel;
  });

  const customModels = currentModels.filter(
    (model) => !defaultKeys.has(getModelKeyFromModel(model))
  );

  return [...restoredBuiltIns, ...customModels];
}

function preserveProvidersWithCredentials(
  providers: Record<string, Provider> | undefined
): Record<string, Provider> {
  const preserved = Object.entries(providers ?? {}).filter(
    ([, provider]) => !!provider?.apiKeyKeychainId
  );
  return preserved.length > 0 ? Object.fromEntries(preserved) : EMPTY_PROVIDERS;
}

function preserveConfiguredModelsForProviders(
  configuredModels: ConfiguredModel[] | undefined,
  preservedProviderIds: Set<string>
): ConfiguredModel[] {
  if (!Array.isArray(configuredModels) || configuredModels.length === 0) {
    return EMPTY_CONFIGURED_MODELS;
  }
  const preserved = configuredModels.filter((model) => preservedProviderIds.has(model.providerId));
  return preserved.length > 0 ? preserved : EMPTY_CONFIGURED_MODELS;
}

export function resetSettings(): void {
  const current = getSettings();
  const currentRecord = current as unknown as Record<string, unknown>;
  const preservedRootHistory = normalizeRootFolders([
    ...(Array.isArray(current.copilotRootHistory) ? current.copilotRootHistory : []),
    current.copilotFolder,
  ]);
  const preservedTopLevelSecrets: Record<string, unknown> = {};
  for (const field of TOP_LEVEL_CREDENTIAL_BUNDLE_FIELDS) {
    const value = currentRecord[field];
    if (carriesConfiguration(field, value)) {
      preservedTopLevelSecrets[field] = value;
    }
  }
  const preservedProviders = preserveProvidersWithCredentials(current.providers);
  const preservedProviderIds = new Set(Object.keys(preservedProviders));
  const defaultSettingsWithBuiltIns = {
    ...DEFAULT_SETTINGS,
    ...preservedTopLevelSecrets,
    activeModels: preserveModelCredentials(
      BUILTIN_CHAT_MODELS.map((model) => ({ ...model, enabled: true })),
      current.activeModels ?? []
    ),
    providers: preservedProviders,
    configuredModels: preserveConfiguredModelsForProviders(
      current.configuredModels,
      preservedProviderIds
    ),
    copilotRootHistory: preservedRootHistory,
  };
  setSettings(defaultSettingsWithBuiltIns);
}

export function subscribeToSettingsChange(
  callback: (prev: CopilotSettings, next: CopilotSettings) => void
): () => void {
  let previousValue = getSettings();

  return settingsStore.sub(settingsAtom, () => {
    const currentValue = getSettings();
    callback(previousValue, currentValue);
    previousValue = currentValue;
  });
}

export function useSettingsValue(): Readonly<CopilotSettings> {
  return useAtomValue(settingsAtom, {
    store: settingsStore,
  });
}

const RETIRED_SETTINGS_FIELDS = [
  "userId",
  "plusLicenseKey",
  "entitlementToken",
  "entitlementExpiresAt",
  "isPaidUser",
  "isPlusUser",
  "openAIApiKey",
  "openAIOrgId",
  "huggingfaceApiKey",
  "cohereApiKey",
  "anthropicApiKey",
  "googleApiKey",
  "openRouterAiApiKey",
  "xaiApiKey",
  "mistralApiKey",
  "deepseekApiKey",
  "siliconflowApiKey",
  "groqApiKey",
  "openAIProxyBaseUrl",
  "enableSelfHostMode",
  "selfHostSearchProvider",
  "firecrawlApiKey",
  "perplexityApiKey",
  "parallelApiKey",
  "exaApiKey",
  "supadataApiKey",
  "docProcessorBackend",
  "enableMiyo",
  "enableMiyoSearchSkill",
  "miyoSearchAll",
  "miyoServerUrl",
  "miyoConnectionMode",
  "miyoRemoteVaultPath",
  "miyoVaultName",
  "copilotPlusCatalog",
  "agentMode",
  "_pendingCredentialRecovery",
  "maxTokens",
  "amazonBedrockApiKey",
  "amazonBedrockRegion",
  "azureOpenAIApiKey",
  "azureOpenAIApiInstanceName",
  "azureOpenAIApiDeploymentName",
  "azureOpenAIApiVersion",
];

export function sanitizeSettings(settings: CopilotSettings): CopilotSettings {
  const settingsToSanitize = settings || DEFAULT_SETTINGS;

  const sanitizedSettings: CopilotSettings = { ...settingsToSanitize };
  sanitizedSettings.lastShownStartupVersion ??= null;
  const sanitizedSettingsRecord = sanitizedSettings as unknown as Record<string, unknown>;
  for (const field of RETIRED_SETTINGS_FIELDS) {
    delete sanitizedSettingsRecord[field];
  }

  const contextTurns = Number(settingsToSanitize.contextTurns);
  sanitizedSettings.contextTurns = isNaN(contextTurns)
    ? DEFAULT_SETTINGS.contextTurns
    : contextTurns;

  const lexicalSearchRamLimit = Number(settingsToSanitize.lexicalSearchRamLimit);
  if (isNaN(lexicalSearchRamLimit)) {
    sanitizedSettings.lexicalSearchRamLimit = DEFAULT_SETTINGS.lexicalSearchRamLimit;
  } else {
    sanitizedSettings.lexicalSearchRamLimit = Math.min(1000, Math.max(20, lexicalSearchRamLimit));
  }

  if (typeof sanitizedSettings.autoAddActiveContentToContext !== "boolean") {
    const oldNoteContext = (settingsToSanitize as unknown as Record<string, unknown>)
      .includeActiveNoteAsContext;
    if (typeof oldNoteContext === "boolean") {
      sanitizedSettings.autoAddActiveContentToContext = oldNoteContext;
    } else {
      sanitizedSettings.autoAddActiveContentToContext =
        DEFAULT_SETTINGS.autoAddActiveContentToContext;
    }
  }

  if (typeof sanitizedSettings.relevantNotesLiveUpdate !== "boolean") {
    sanitizedSettings.relevantNotesLiveUpdate = DEFAULT_SETTINGS.relevantNotesLiveUpdate;
  }

  if (typeof sanitizedSettings.passMarkdownImages !== "boolean") {
    sanitizedSettings.passMarkdownImages = DEFAULT_SETTINGS.passMarkdownImages;
  }

  if (typeof sanitizedSettings.enableInlineCitations !== "boolean") {
    sanitizedSettings.enableInlineCitations = DEFAULT_SETTINGS.enableInlineCitations;
  }

  if (typeof sanitizedSettings.enableCustomPromptTemplating !== "boolean") {
    sanitizedSettings.enableCustomPromptTemplating = DEFAULT_SETTINGS.enableCustomPromptTemplating;
  }

  for (const key of [
    "thinkingInChat",
    "thinkingInAgent",
    "thinkingInCustomCommands",
    "useLocalEmbeddings",
  ] as const) {
    if (typeof sanitizedSettings[key] !== "boolean") {
      sanitizedSettings[key] = DEFAULT_SETTINGS[key];
    }
  }

  if (typeof sanitizedSettings.localEmbeddingModelKey !== "string") {
    sanitizedSettings.localEmbeddingModelKey = DEFAULT_SETTINGS.localEmbeddingModelKey;
  }

  if (!Array.isArray(sanitizedSettings.autonomousAgentEnabledToolIds)) {
    sanitizedSettings.autonomousAgentEnabledToolIds =
      DEFAULT_SETTINGS.autonomousAgentEnabledToolIds;
  }

  const toolIdRenames: Record<string, string> = {
    writeToFile: "writeFile",
    replaceInFile: "editFile",
  };
  const retiredToolIds = new Set(["webSearch", "youtubeTranscription"]);
  sanitizedSettings.autonomousAgentEnabledToolIds = sanitizedSettings.autonomousAgentEnabledToolIds
    .map((id) => toolIdRenames[id] ?? id)
    .filter((id) => !retiredToolIds.has(id));

  if (
    !sanitizedSettings.memoryFolderName ||
    typeof sanitizedSettings.memoryFolderName !== "string"
  ) {
    sanitizedSettings.memoryFolderName = DEFAULT_SETTINGS.memoryFolderName;
  }

  if (typeof sanitizedSettings.enableRecentConversations !== "boolean") {
    sanitizedSettings.enableRecentConversations = DEFAULT_SETTINGS.enableRecentConversations;
  }

  if (typeof sanitizedSettings.enableSavedMemory !== "boolean") {
    sanitizedSettings.enableSavedMemory = DEFAULT_SETTINGS.enableSavedMemory;
  }

  const maxRecentConversations = Number(settingsToSanitize.maxRecentConversations);
  if (isNaN(maxRecentConversations) || maxRecentConversations < 10 || maxRecentConversations > 50) {
    sanitizedSettings.maxRecentConversations = DEFAULT_SETTINGS.maxRecentConversations;
  } else {
    sanitizedSettings.maxRecentConversations = maxRecentConversations;
  }

  if (typeof sanitizedSettings.autosaveChat !== "boolean") {
    sanitizedSettings.autosaveChat = DEFAULT_SETTINGS.autosaveChat;
  }

  const autoCompactThreshold = Number(settingsToSanitize.autoCompactThreshold);
  if (isNaN(autoCompactThreshold)) {
    sanitizedSettings.autoCompactThreshold = DEFAULT_SETTINGS.autoCompactThreshold;
  } else {
    sanitizedSettings.autoCompactThreshold = Math.min(
      1000000,
      Math.max(64000, autoCompactThreshold)
    );
  }

  if (typeof sanitizedSettings.quickCommandIncludeNoteContext !== "boolean") {
    sanitizedSettings.quickCommandIncludeNoteContext =
      DEFAULT_SETTINGS.quickCommandIncludeNoteContext;
  }

  if (
    settingsToSanitize.quickCommandModelKey !== undefined &&
    typeof settingsToSanitize.quickCommandModelKey !== "string"
  ) {
    sanitizedSettings.quickCommandModelKey = DEFAULT_SETTINGS.quickCommandModelKey;
  }

  if (typeof sanitizedSettings.autoAcceptEdits !== "boolean") {
    sanitizedSettings.autoAcceptEdits = DEFAULT_SETTINGS.autoAcceptEdits;
  }

  if (!Object.values(SEND_SHORTCUT).includes(sanitizedSettings.defaultSendShortcut)) {
    sanitizedSettings.defaultSendShortcut = DEFAULT_SETTINGS.defaultSendShortcut;
  }

  const copilotFolderValidation = validateCopilotFolder(
    typeof settingsToSanitize.copilotFolder === "string" ? settingsToSanitize.copilotFolder : ""
  );
  sanitizedSettings.copilotFolder = copilotFolderValidation.ok
    ? copilotFolderValidation.folder
    : DEFAULT_SETTINGS.copilotFolder;

  const rawRootHistory = Array.isArray(settingsToSanitize.copilotRootHistory)
    ? settingsToSanitize.copilotRootHistory
    : [];
  sanitizedSettings.copilotRootHistory = normalizeRootFolders([
    ...rawRootHistory,
    sanitizedSettings.copilotFolder,
  ]);

  if (typeof sanitizedSettings.upgradedToV8FromLegacy !== "boolean") {
    sanitizedSettings.upgradedToV8FromLegacy = DEFAULT_SETTINGS.upgradedToV8FromLegacy;
  }

  const saveFolder = (settingsToSanitize.defaultSaveFolder || "").trim();
  sanitizedSettings.defaultSaveFolder =
    saveFolder.length > 0 ? saveFolder : DEFAULT_SETTINGS.defaultSaveFolder;

  const promptsFolder = (settingsToSanitize.customPromptsFolder || "").trim();
  sanitizedSettings.customPromptsFolder =
    promptsFolder.length > 0 ? promptsFolder : DEFAULT_SETTINGS.customPromptsFolder;

  const projectsFolder = (settingsToSanitize.projectsFolder || "").trim();
  const hasTraversal =
    /(^|[/\\])\.\.[/\\]?/.test(projectsFolder) ||
    /^[a-zA-Z]:/.test(projectsFolder) ||
    /^[/\\]/.test(projectsFolder);
  sanitizedSettings.projectsFolder =
    projectsFolder.length > 0 && !hasTraversal ? projectsFolder : DEFAULT_SETTINGS.projectsFolder;

  if (
    !isSortStrategy(sanitizedSettings.chatHistorySortStrategy) ||
    sanitizedSettings.chatHistorySortStrategy === "manual"
  ) {
    sanitizedSettings.chatHistorySortStrategy = DEFAULT_SETTINGS.chatHistorySortStrategy;
  }

  if (!Object.values(ChainType).includes(sanitizedSettings.defaultChainType)) {
    sanitizedSettings.defaultChainType = DEFAULT_SETTINGS.defaultChainType;
  }

  const userSystemPromptsFolder = (settingsToSanitize.userSystemPromptsFolder || "").trim();
  sanitizedSettings.userSystemPromptsFolder =
    userSystemPromptsFolder.length > 0
      ? userSystemPromptsFolder
      : DEFAULT_SETTINGS.userSystemPromptsFolder;

  sanitizedSettings.qaExclusions = sanitizeQaExclusions(settingsToSanitize.qaExclusions);

  if (
    !sanitizedSettings.providers ||
    typeof sanitizedSettings.providers !== "object" ||
    Array.isArray(sanitizedSettings.providers)
  ) {
    sanitizedSettings.providers = EMPTY_PROVIDERS;
  }
  if (!Array.isArray(sanitizedSettings.configuredModels)) {
    sanitizedSettings.configuredModels = EMPTY_CONFIGURED_MODELS;
  }
  if (
    !sanitizedSettings.backends ||
    typeof sanitizedSettings.backends !== "object" ||
    Array.isArray(sanitizedSettings.backends)
  ) {
    sanitizedSettings.backends = EMPTY_BACKENDS;
  }

  return sanitizedSettings;
}

const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// eslint-disable-next-line no-control-regex -- settings paths must reject embedded control bytes
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

export function validateCopilotFolder(
  value: string,
  configDir?: string
): { ok: true; folder: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, reason: "Folder name cannot be empty." };
  }
  const trimmed = value.trim();
  if (/^[/\\]/.test(trimmed) || /^[a-zA-Z]:/.test(trimmed)) {
    return { ok: false, reason: "Folder path must be relative to the vault root." };
  }
  const cleaned = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  if (cleaned.length === 0) {
    return { ok: false, reason: "Folder name cannot be empty." };
  }
  const normalizedConfigDir = configDir
    ?.trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  const cleanedLower = cleaned.toLowerCase();
  if (
    normalizedConfigDir &&
    (cleanedLower === normalizedConfigDir ||
      cleanedLower.startsWith(`${normalizedConfigDir}/`) ||
      normalizedConfigDir.startsWith(`${cleanedLower}/`))
  ) {
    return {
      ok: false,
      reason: "Folder path cannot use the Obsidian config folder.",
    };
  }
  for (const segment of cleaned.split("/")) {
    if (segment.length === 0) {
      return { ok: false, reason: "Folder path cannot contain empty segments (//)." };
    }
    if (segment === "..") {
      return { ok: false, reason: 'Folder path cannot contain ".." segments.' };
    }
    if (segment === ".") {
      return { ok: false, reason: 'Folder path cannot contain "." segments.' };
    }
    if (CONTROL_CHAR_RE.test(segment)) {
      return { ok: false, reason: "Folder path contains illegal control characters." };
    }
    if (/[<>:"|?*]/.test(segment)) {
      return {
        ok: false,
        reason: 'Folder path contains characters not allowed in folder names (< > : " | ? *).',
      };
    }
    if (/[. ]$/.test(segment)) {
      return { ok: false, reason: "Folder names cannot end with a dot or space." };
    }
    if (WINDOWS_RESERVED_NAME_RE.test(segment)) {
      return { ok: false, reason: `"${segment}" is a name reserved by Windows.` };
    }
  }
  return { ok: true, folder: cleaned };
}

export const ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function sanitizeEnvOverrides(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string") continue;
    if (!ENV_VAR_NAME_RE.test(k)) continue;
    if (typeof v !== "string") continue;
    if (CONTROL_CHAR_RE.test(v)) continue;
    out[k] = v;
    if (Object.keys(out).length >= 64) break;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mergeActiveChatModelsWithCoreModels(settings: CopilotSettings): CopilotSettings {
  settings.activeModels = mergeActiveModels(settings.activeModels, BUILTIN_CHAT_MODELS);
  return settings;
}

function mergeActiveModels(
  existingActiveModels: CustomModel[],
  builtInModels: CustomModel[]
): CustomModel[] {
  const modelMap = new Map<string, CustomModel>();

  builtInModels
    .filter((model) => model.core)
    .forEach((model) => {
      modelMap.set(getModelKeyFromModel(model), { ...model });
    });

  existingActiveModels.forEach((model) => {
    const key = getModelKeyFromModel(model);
    const existingModel = modelMap.get(key);
    if (existingModel) {
      const builtInModel = builtInModels.find(
        (m) => m.name === model.name && m.provider === model.provider
      );
      if (builtInModel) {
        modelMap.set(key, {
          ...builtInModel,
          ...model,
          isBuiltIn: true,
        });
      } else {
        modelMap.set(key, {
          ...model,
          isBuiltIn: existingModel.isBuiltIn,
        });
      }
    } else {
      modelMap.set(key, model);
    }
  });

  return Array.from(modelMap.values());
}
