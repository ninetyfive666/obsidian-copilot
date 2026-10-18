import { CustomModel } from "@/aiParams";
import { type CopilotSettings } from "@/settings/model";
import { ChainType } from "./chainType";
import { PromptSortStrategy } from "./types";

export const CHAT_VIEWTYPE = "copilot-chat-view";
export const RELEVANT_NOTES_VIEWTYPE = "copilot-relevant-notes-view";

export const USER_SENDER = "user";
export const AI_SENDER = "ai";

export const COPILOT_FOLDER_ROOT = "copilot";
export const DEFAULT_COPILOT_FOLDER = COPILOT_FOLDER_ROOT;
const DEFAULT_CHAT_HISTORY_FOLDER = `${COPILOT_FOLDER_ROOT}/copilot-conversations`;
const DEFAULT_CUSTOM_PROMPTS_FOLDER = `${COPILOT_FOLDER_ROOT}/copilot-custom-prompts`;
const DEFAULT_MEMORY_FOLDER = `${COPILOT_FOLDER_ROOT}/memory`;
const DEFAULT_SYSTEM_PROMPTS_FOLDER = `${COPILOT_FOLDER_ROOT}/system-prompts`;
const DEFAULT_PROJECTS_FOLDER = `${COPILOT_FOLDER_ROOT}/projects`;
const DEFAULT_CONVERTED_DOC_OUTPUT_FOLDER = "";
export const COPILOT_CONVERSATION_TAG = "copilot-conversation";
export const DEFAULT_QA_EXCLUSIONS_SETTING = COPILOT_FOLDER_ROOT;
export const DEFAULT_SYSTEM_PROMPT = `You are Obsidian Copilot, a helpful assistant that integrates AI to Obsidian note-taking.
  1. Never mention that you do not have access to something. Always rely on the user provided context.
  2. Always answer to the best of your knowledge. If you are unsure about something, say so and ask the user to provide more context.
  3. If the user mentions "note", it most likely means an Obsidian note in the vault, not the generic meaning of a note.
  4. If the user mentions "@vault", it means the user wants you to search the Obsidian vault for information relevant to the query. The search results will be provided to you in the context along with the user query, read it carefully and answer the question based on the information provided. If there's no relevant information in the vault, just say so.
  5. If the user mentions any other tool with the @ symbol, check the context for their results. If nothing is found, just ignore the @ symbol in the query.
  6. Always use $'s instead of \\[ etc. for LaTeX equations.
  7. When showing note titles, use [[title]] format and do not wrap them in \` \`.
  8. When showing **Obsidian internal** image links, use ![[link]] format and do not wrap them in \` \`.
  9. When showing **web** image links, use ![link](url) format and do not wrap them in \` \`.
  10. When generating a table, format as github markdown tables, however, for table headings, immediately add ' |' after the table heading.
  11. Always respond in the language of the user's query.
  12. Do NOT mention the additional context provided such as getCurrentTime and getTimeRangeMs if it's irrelevant to the user message.
  13. If the user mentions "tags", it most likely means tags in Obsidian note properties.`;

export const COMPOSER_OUTPUT_INSTRUCTIONS = `Return the new note content or canvas JSON in <writeFile> tags.

  # Steps to find the the target notes
  1. Extract the target note information from user message and find out the note path from the context below.
  2. If target note is not specified, use the <active_note> as the target note.
  3. If still failed to find the target note or the note path, ask the user to specify the target note.

  # Examples

  Input: Add a new section to note A
  Output:
  <writeFile>
  <path>path/to/file.md</path>
  <content>The FULL CONTENT of the note A with added section goes here</content>
  </writeFile>

  Input: Create a new canvas with "Hello, world!"
  Output:
  <writeFile>
  <path>path/to/file.canvas</path>
  <content>
  {
    "nodes": [
      {
        "id": "1",
        "type": "text",
        "text": "Hello, world!",
        "x": 0,
        "y": 0,
        "width": 200,
        "height": 50
      }
    ],
    "edges": []
  }
  </content>
  </writeFile>

  Input: Create a canvas with a file node and a group
  Output:
  <writeFile>
  <path>path/to/file.canvas</path>
  <content>
  {
    "nodes": [
      {"id": "1", "type": "file", "file": "note.md", "subpath": "#heading", "x": 100, "y": 100, "width": 300, "height": 200, "color": "2"},
      {"id": "2", "type": "group", "label": "My Group", "x": 50, "y": 50, "width": 400, "height": 300, "color": "1"},
      {"id": "3", "type": "link", "url": "https://example.com", "x": 500, "y": 100, "width": 200, "height": 100, "color": "#FF5733"}
    ],
    "edges": [
      {"id": "e1-2", "fromNode": "1", "toNode": "3", "fromSide": "right", "toSide": "left", "fromEnd": "arrow", "toEnd": "none", "color": "3", "label": "references"}
    ]
  }
  </content>
  </writeFile>

  # Canvas JSON Format (JSON Canvas spec 1.0)
  Required node fields: id, type, x, y, width, height
  Node types: "text" (needs text), "file" (needs file), "link" (needs url), "group" (optional label)
  Optional node fields: color (hex #FF0000 or preset "1"-"6"), subpath (file nodes, starts with #)
  Required edge fields: id, fromNode, toNode
  Optional edge fields: fromSide/toSide ("top"/"right"/"bottom"/"left"), fromEnd/toEnd ("none"/"arrow"), color, label
  All IDs must be unique. Edge nodes must reference existing node IDs.
  Position nodes with reasonable spacing and logical visual flow.
  `;

export const NOTE_CONTEXT_PROMPT_TAG = "note_context";
export const SELECTED_TEXT_TAG = "selected_text";
export const WEB_SELECTED_TEXT_TAG = "web_selected_text";
export const VARIABLE_TAG = "variable";
export const VARIABLE_NOTE_TAG = "variable_note";
export const EMBEDDED_PDF_TAG = "embedded_pdf";
export const EMBEDDED_NOTE_TAG = "embedded_note";
export const DATAVIEW_BLOCK_TAG = "dataview_block";
export const WEB_TAB_CONTEXT_TAG = "web_tab_context";
export const ACTIVE_WEB_TAB_CONTEXT_TAG = "active_web_tab";
export const YOUTUBE_VIDEO_CONTEXT_TAG = "youtube_video_context";
export const ACTIVE_WEB_TAB_MARKER = "{activeWebTab}";
export const CHUNK_SIZE = 6000;
export const TEXT_WEIGHT = 0.4;
export const MAX_CHARS_FOR_LOCAL_SEARCH_CONTEXT = 448000;
export const LLM_TIMEOUT_MS = 30000;
const DEFAULT_MAX_SOURCE_CHUNKS = 30;
export const AGENT_LOOP_TIMEOUT_MS = 5 * 60 * 1000;
export const LOADING_MESSAGES = {
  DEFAULT: "",
  READING_FILES: "Reading files",
  READING_FILE_TREE: "Reading file tree",
  COMPACTING: "Compacting",
};

export enum ReasoningEffort {
  MINIMAL = "minimal",
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  XHIGH = "xhigh",
}

export enum Verbosity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

export const DEFAULT_MAX_OUTPUT_TOKENS = 20_000;

export const DEFAULT_MODEL_SETTING = {
  TEMPERATURE: 0.1,
  REASONING_EFFORT: ReasoningEffort.LOW,
  VERBOSITY: Verbosity.MEDIUM,
} as const;

export const DEFAULT_OLLAMA_NUM_CTX = 131072;

export enum ChatModelProviders {
  OLLAMA = "ollama",
  LM_STUDIO = "lm-studio",
  OPENAI_FORMAT = "3rd party (openai-format)",
}

export enum ModelCapability {
  REASONING = "reasoning",
  VISION = "vision",
  WEB_SEARCH = "websearch",
}

export const BUILTIN_CHAT_MODELS: CustomModel[] = [];

export type Provider = ChatModelProviders;

export interface ProviderMetadata {
  label: string;
  host: string;
  curlBaseURL: string;
  keyManagementURL: string;
}

export const ProviderInfo: Record<Provider, ProviderMetadata> = {
  [ChatModelProviders.OLLAMA]: {
    label: "Ollama",
    host: "http://localhost:11434/v1/",
    curlBaseURL: "http://localhost:11434",
    keyManagementURL: "",
  },
  [ChatModelProviders.LM_STUDIO]: {
    label: "LM Studio",
    host: "http://localhost:1234/v1",
    curlBaseURL: "http://localhost:1234/v1",
    keyManagementURL: "",
  },
  [ChatModelProviders.OPENAI_FORMAT]: {
    label: "OpenAI Format",
    host: "http://localhost:8080/v1",
    curlBaseURL: "http://localhost:8080/v1",
    keyManagementURL: "",
  },
};

export enum DEFAULT_OPEN_AREA {
  EDITOR = "editor",
  VIEW = "view",
}

export enum SEND_SHORTCUT {
  ENTER = "enter",
  SHIFT_ENTER = "shift+enter",
}

export const COMMAND_IDS = {
  TRIGGER_QUICK_COMMAND: "trigger-quick-command",
  CLEAR_COPILOT_CACHE: "clear-copilot-cache",
  COUNT_WORD_AND_TOKENS_SELECTION: "count-word-and-tokens-selection",
  COUNT_TOTAL_VAULT_TOKENS: "count-total-vault-tokens",
  DEBUG_WORD_COMPLETION: "debug-word-completion",
  LOAD_COPILOT_CHAT_CONVERSATION: "load-copilot-chat-conversation",
  NEW_CHAT: "new-chat",
  OPEN_COPILOT_CHAT_WINDOW: "chat-open-window",
  OPEN_RELEVANT_NOTES_VIEW: "open-relevant-notes-view",
  TOGGLE_COPILOT_CHAT_WINDOW: "chat-toggle-window",
  ADD_SELECTION_TO_CHAT_CONTEXT: "add-selection-to-chat-context",
  ADD_WEB_SELECTION_TO_CHAT_CONTEXT: "add-web-selection-to-chat-context",
  ADD_CUSTOM_COMMAND: "add-custom-command",
  APPLY_CUSTOM_COMMAND: "apply-custom-command",
  OPEN_LOG_FILE: "open-log-file",
  CLEAR_LOG_FILE: "clear-log-file",
  TRIGGER_QUICK_ASK: "trigger-quick-ask",
} as const;

export const COMMAND_NAMES: Record<CommandId, string> = {
  [COMMAND_IDS.TRIGGER_QUICK_COMMAND]: "Trigger quick command",
  [COMMAND_IDS.CLEAR_COPILOT_CACHE]: "Clear Copilot cache",
  [COMMAND_IDS.COUNT_TOTAL_VAULT_TOKENS]: "Count total tokens in your vault",
  [COMMAND_IDS.COUNT_WORD_AND_TOKENS_SELECTION]: "Count words and tokens in selection",
  [COMMAND_IDS.DEBUG_WORD_COMPLETION]: "Word completion: Debug",
  [COMMAND_IDS.LOAD_COPILOT_CHAT_CONVERSATION]: "Load Copilot chat conversation",
  [COMMAND_IDS.NEW_CHAT]: "New Copilot Quick Chat",
  [COMMAND_IDS.OPEN_COPILOT_CHAT_WINDOW]: "Open Copilot Chat Window",
  [COMMAND_IDS.OPEN_RELEVANT_NOTES_VIEW]: "Open Relevant Notes",
  [COMMAND_IDS.TOGGLE_COPILOT_CHAT_WINDOW]: "Toggle Copilot Chat Window",
  [COMMAND_IDS.ADD_SELECTION_TO_CHAT_CONTEXT]: "Add selection to chat context",
  [COMMAND_IDS.ADD_WEB_SELECTION_TO_CHAT_CONTEXT]: "Add web selection to chat context",
  [COMMAND_IDS.ADD_CUSTOM_COMMAND]: "Add new custom command",
  [COMMAND_IDS.APPLY_CUSTOM_COMMAND]: "Apply custom command",
  [COMMAND_IDS.OPEN_LOG_FILE]: "Create log file",
  [COMMAND_IDS.CLEAR_LOG_FILE]: "Clear log file",
  [COMMAND_IDS.TRIGGER_QUICK_ASK]: "Quick Ask",
};

export type CommandId = (typeof COMMAND_IDS)[keyof typeof COMMAND_IDS];

export const COMMAND_ICONS: Partial<Record<CommandId, string>> = {
  [COMMAND_IDS.NEW_CHAT]: "message-square-plus",
  [COMMAND_IDS.OPEN_COPILOT_CHAT_WINDOW]: "message-square",
  [COMMAND_IDS.OPEN_RELEVANT_NOTES_VIEW]: "files",
  [COMMAND_IDS.TOGGLE_COPILOT_CHAT_WINDOW]: "message-square",
  [COMMAND_IDS.LOAD_COPILOT_CHAT_CONVERSATION]: "history",
  [COMMAND_IDS.TRIGGER_QUICK_COMMAND]: "terminal-square",
  [COMMAND_IDS.TRIGGER_QUICK_ASK]: "sparkles",
  [COMMAND_IDS.ADD_SELECTION_TO_CHAT_CONTEXT]: "text-cursor-input",
  [COMMAND_IDS.ADD_WEB_SELECTION_TO_CHAT_CONTEXT]: "globe",
  [COMMAND_IDS.ADD_CUSTOM_COMMAND]: "plus-circle",
  [COMMAND_IDS.APPLY_CUSTOM_COMMAND]: "play-circle",
  [COMMAND_IDS.CLEAR_COPILOT_CACHE]: "eraser",
  [COMMAND_IDS.COUNT_TOTAL_VAULT_TOKENS]: "calculator",
  [COMMAND_IDS.COUNT_WORD_AND_TOKENS_SELECTION]: "hash",
  [COMMAND_IDS.OPEN_LOG_FILE]: "file-text",
  [COMMAND_IDS.CLEAR_LOG_FILE]: "file-x",
};

export const TEXT_READABLE_EXTENSIONS = ["md", "canvas", "base"];

export const ALLOWED_NOTE_CONTEXT_EXTENSIONS = [...TEXT_READABLE_EXTENSIONS, "pdf"];

export const RESTRICTION_MESSAGES = {
  NON_MARKDOWN_FILES_RESTRICTED:
    "Non-markdown files are not available in the local-only plugin. PDFs and other binaries cannot be converted offline.",
  URL_PROCESSING_RESTRICTED:
    "URL processing requires an external converter and is not available offline. URLs will not be processed for context.",
  UNSUPPORTED_FILE_TYPE: (extension: string) =>
    `${extension.toUpperCase()} files are not supported in the current mode.`,
} as const;

export const DEFAULT_SETTINGS: CopilotSettings = {
  defaultChainType: ChainType.LLM_CHAIN,
  defaultModelKey: "",
  contextTurns: 15,
  lastDismissedVersion: null,
  lastShownStartupVersion: null,
  userSystemPrompt: "",
  stream: true,
  copilotFolder: DEFAULT_COPILOT_FOLDER,
  copilotRootHistory: [],
  upgradedToV8FromLegacy: false,
  defaultSaveFolder: DEFAULT_CHAT_HISTORY_FOLDER,
  defaultConversationTag: "copilot-conversation",
  autosaveChat: true,
  autoAddActiveContentToContext: true,
  defaultOpenArea: DEFAULT_OPEN_AREA.VIEW,
  defaultSendShortcut: SEND_SHORTCUT.ENTER,
  customPromptsFolder: DEFAULT_CUSTOM_PROMPTS_FOLDER,
  qaExclusions: DEFAULT_QA_EXCLUSIONS_SETTING,
  qaInclusions: "",
  chatNoteContextPath: "",
  chatNoteContextTags: [],
  debug: false,
  maxSourceChunks: DEFAULT_MAX_SOURCE_CHUNKS,
  enableInlineCitations: true,
  activeModels: BUILTIN_CHAT_MODELS,
  lexicalSearchRamLimit: 100,
  promptUsageTimestamps: {},
  promptSortStrategy: PromptSortStrategy.TIMESTAMP,
  chatHistorySortStrategy: "recent",
  projectsFolder: DEFAULT_PROJECTS_FOLDER,
  defaultConversationNoteName: "{$topic}@{$date}_{$time}",
  inlineEditCommands: [],
  projectList: [],
  passMarkdownImages: true,
  enableAutonomousAgent: true,
  enableCustomPromptTemplating: true,
  relevantNotesLiveUpdate: true,
  enableLexicalBoosts: true,
  suggestedDefaultCommands: false,
  autonomousAgentEnabledToolIds: [
    "localSearch",
    "readNote",
    "writeFile",
    "editFile",
    "updateMemory",
  ],
  reasoningEffort: DEFAULT_MODEL_SETTING.REASONING_EFFORT,
  verbosity: DEFAULT_MODEL_SETTING.VERBOSITY,
  memoryFolderName: DEFAULT_MEMORY_FOLDER,
  enableRecentConversations: true,
  maxRecentConversations: 30,
  enableSavedMemory: true,
  quickCommandModelKey: undefined,
  quickCommandIncludeNoteContext: true,
  autoAcceptEdits: false,
  diffViewMode: "split",
  userSystemPromptsFolder: DEFAULT_SYSTEM_PROMPTS_FOLDER,
  defaultSystemPromptTitle: "",
  autoCompactThreshold: 128000,
  convertedDocOutputFolder: DEFAULT_CONVERTED_DOC_OUTPUT_FOLDER,
  providers: {},
  configuredModels: [],
  backends: {},
};

export const EVENT_NAMES = {
  CHAT_IS_VISIBLE: "chat-is-visible",
  ACTIVE_LEAF_CHANGE: "active-leaf-change",
  ABORT_STREAM: "abort-stream",
  INSERT_TEXT_TO_CHAT: "insert-text-to-chat",
};

export enum ABORT_REASON {
  USER_STOPPED = "user-stopped",
  NEW_CHAT = "new-chat",
  UNMOUNT = "component-unmount",
}
