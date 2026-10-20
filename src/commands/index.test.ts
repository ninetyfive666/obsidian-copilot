jest.mock("@/commands/CustomCommandChatModal", () => ({
  CustomCommandChatModal: jest.fn(),
}));
jest.mock("@/utils/desktopRuntime", () => ({
  isDesktopRuntime: jest.fn(() => false),
}));

let mockSemanticSearchEnabled = true;
jest.mock("@/settings/model", () => {
  const actual = jest.requireActual<Record<string, unknown>>("@/settings/model");
  return {
    ...actual,
    getSettings: jest.fn(() => ({ useLocalEmbeddings: mockSemanticSearchEnabled })),
  };
});

const mockConfirmBehavior: { value: "confirm" | "cancel" } = { value: "confirm" };
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: class MockConfirmModal {
    onConfirm: () => void;
    onCancel?: () => void;
    constructor(
      _app: unknown,
      onConfirm: () => void,
      _content: unknown,
      _title: string,
      _confirmText?: string,
      _cancelText?: string,
      onCancel?: () => void
    ) {
      this.onConfirm = onConfirm;
      this.onCancel = onCancel;
    }
    open() {
      queueMicrotask(() => {
        if (mockConfirmBehavior.value === "confirm") {
          this.onConfirm();
        } else {
          this.onCancel?.();
        }
      });
    }
  },
}));

jest.mock("@/search/embeddings/localEmbeddingService", () => ({
  clearLocalEmbeddingIndex: jest.fn().mockResolvedValue(undefined),
  refreshLocalEmbeddingIndex: jest.fn().mockResolvedValue(2),
  reindexLocalEmbeddingIndex: jest.fn().mockResolvedValue(2),
  listIndexedNotes: jest.fn().mockReturnValue(["a.md"]),
  initLocalEmbeddings: jest.fn(),
  getLocalEmbeddingService: jest.fn().mockReturnValue(null),
  resetLocalEmbeddingsForTesting: jest.fn(),
  pauseLocalEmbeddingIndex: jest.fn(),
  resumeLocalEmbeddingIndex: jest.fn(),
  stopLocalEmbeddingIndex: jest.fn(),
}));

jest.mock("@/search/searchUtils", () => {
  const actual = jest.requireActual<Record<string, unknown>>("@/search/searchUtils");
  return {
    ...actual,
    getMatchingPatterns: jest.fn(() => ({ inclusions: null, exclusions: null })),
    shouldIndexFile: jest.fn(() => true),
  };
});

jest.mock("@/settings/copilotFolder", () => ({
  getEffectiveCopilotFolder: jest.fn(() => "Copilot"),
  getEffectiveProjectsFolder: jest.fn(() => "Copilot/Projects"),
}));

import { registerCommands } from "@/commands";
import { COMMAND_ICONS, COMMAND_IDS, COMMAND_NAMES, CommandId } from "@/constants";
import {
  clearLocalEmbeddingIndex,
  listIndexedNotes,
  refreshLocalEmbeddingIndex,
  reindexLocalEmbeddingIndex,
} from "@/search/embeddings/localEmbeddingService";
import { shouldIndexFile } from "@/search/searchUtils";
import type CopilotPlugin from "@/main";
import { Notice, TFile, type Command } from "obsidian";

const REGISTERED_COMMAND_IDS = [
  COMMAND_IDS.COUNT_WORD_AND_TOKENS_SELECTION,
  COMMAND_IDS.COUNT_TOTAL_VAULT_TOKENS,
  COMMAND_IDS.TOGGLE_COPILOT_CHAT_WINDOW,
  COMMAND_IDS.OPEN_COPILOT_CHAT_WINDOW,
  COMMAND_IDS.OPEN_RELEVANT_NOTES_VIEW,
  COMMAND_IDS.NEW_CHAT,
  COMMAND_IDS.TRIGGER_QUICK_COMMAND,
  COMMAND_IDS.LOAD_COPILOT_CHAT_CONVERSATION,
  COMMAND_IDS.CLEAR_COPILOT_CACHE,
  COMMAND_IDS.OPEN_LOG_FILE,
  COMMAND_IDS.CLEAR_LOG_FILE,
  COMMAND_IDS.ADD_SELECTION_TO_CHAT_CONTEXT,
  COMMAND_IDS.ADD_WEB_SELECTION_TO_CHAT_CONTEXT,
  COMMAND_IDS.ADD_CUSTOM_COMMAND,
  COMMAND_IDS.APPLY_CUSTOM_COMMAND,
  COMMAND_IDS.TRIGGER_QUICK_ASK,
  COMMAND_IDS.CLEAR_LOCAL_SEMANTIC_INDEX,
  COMMAND_IDS.REFRESH_LOCAL_SEMANTIC_INDEX,
  COMMAND_IDS.REINDEX_LOCAL_SEMANTIC_INDEX,
  COMMAND_IDS.LIST_SEMANTIC_INDEXED_FILES,
] as const;

function waitForMockCall(mockFn: jest.Mock, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (mockFn.mock.calls.length > 0) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`timed out waiting for a call after ${timeoutMs}ms`));
        return;
      }
      window.setTimeout(check, 10);
    };
    check();
  });
}

function makePlugin() {
  const commands: Command[] = [];
  const plugin = {
    addCommand: jest.fn((command: Command) => commands.push(command)),
    app: { workspace: { getActiveFile: jest.fn(() => null) } },
  } as unknown as CopilotPlugin;
  return { plugin, commands };
}

describe("commands", () => {
  describe("registerCommands()", () => {
    it("registers every local command with its catalog name and icon", () => {
      const { plugin, commands } = makePlugin();

      registerCommands(plugin);

      const registeredIds = commands.map(({ id }) => id as CommandId);
      for (const id of REGISTERED_COMMAND_IDS) {
        const command = commands.find(({ id: commandId }) => commandId === id);
        expect(command?.name).toBe(COMMAND_NAMES[id]);
        expect(command?.icon).toBe(COMMAND_ICONS[id]);
        expect(registeredIds).toContain(id);
      }
    });

    it("opens the relevant notes view through the dedicated command", () => {
      const { plugin, commands } = makePlugin();
      (plugin as unknown as { activateRelevantNotesView: jest.Mock }).activateRelevantNotesView =
        jest.fn().mockResolvedValue(undefined);

      registerCommands(plugin);

      const command = commands.find(({ id }) => id === COMMAND_IDS.OPEN_RELEVANT_NOTES_VIEW);
      void command?.callback?.();
      expect(
        (plugin as unknown as { activateRelevantNotesView: jest.Mock }).activateRelevantNotesView
      ).toHaveBeenCalled();
    });

    it("creates a new chat and clears the recorded prompt payload", () => {
      const { plugin, commands } = makePlugin();
      (plugin as unknown as { newChat: jest.Mock }).newChat = jest
        .fn()
        .mockResolvedValue(undefined);

      registerCommands(plugin);

      const command = commands.find(({ id }) => id === COMMAND_IDS.NEW_CHAT);
      void command?.callback?.();
      expect((plugin as unknown as { newChat: jest.Mock }).newChat).toHaveBeenCalled();
    });

    it("clears the parser and file caches when the cache command runs", async () => {
      const clearPDFCache = jest.fn().mockResolvedValue(undefined);
      const { plugin, commands } = makePlugin();
      (plugin as unknown as { fileParserManager: unknown }).fileParserManager = {
        clearPDFCache,
      };

      registerCommands(plugin);

      const command = commands.find(({ id }) => id === COMMAND_IDS.CLEAR_COPILOT_CACHE);
      await command?.callback?.();
      expect(clearPDFCache).toHaveBeenCalled();
    });

    it("keeps the quick command hidden in source mode and without a selection", () => {
      const { plugin, commands } = makePlugin();
      (plugin as unknown as { app: unknown }).app = {
        workspace: {
          getActiveViewOfType: jest.fn(() => ({
            editor: { getSelection: () => "" },
            getState: () => ({ source: true }),
          })),
        },
      };

      registerCommands(plugin);

      const command = commands.find(({ id }) => id === COMMAND_IDS.TRIGGER_QUICK_COMMAND);
      expect(command?.checkCallback?.(true)).toBe(false);
    });

    beforeEach(() => {
      jest.clearAllMocks();
      mockConfirmBehavior.value = "confirm";
      mockSemanticSearchEnabled = true;
    });

    it("refuses the semantic index commands while the feature is disabled", async () => {
      mockSemanticSearchEnabled = false;
      const { plugin, commands } = makePlugin();
      registerCommands(plugin);

      const ids = [
        COMMAND_IDS.CLEAR_LOCAL_SEMANTIC_INDEX,
        COMMAND_IDS.REFRESH_LOCAL_SEMANTIC_INDEX,
        COMMAND_IDS.REINDEX_LOCAL_SEMANTIC_INDEX,
      ];
      for (const id of ids) {
        jest.mocked(Notice).mockClear();
        await commands.find(({ id: commandId }) => commandId === id)?.callback?.();
        await waitForMockCall(Notice as unknown as jest.Mock);
        expect(Notice).toHaveBeenCalledWith("Local semantic search is disabled in settings.");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      expect(clearLocalEmbeddingIndex).not.toHaveBeenCalled();
      expect(refreshLocalEmbeddingIndex).not.toHaveBeenCalled();
      expect(reindexLocalEmbeddingIndex).not.toHaveBeenCalled();
    });

    it("clears the semantic index after confirmation", async () => {
      const { plugin, commands } = makePlugin();
      registerCommands(plugin);

      await commands.find(({ id }) => id === COMMAND_IDS.CLEAR_LOCAL_SEMANTIC_INDEX)?.callback?.();
      await waitForMockCall(clearLocalEmbeddingIndex as unknown as jest.Mock);

      expect(clearLocalEmbeddingIndex).toHaveBeenCalledTimes(1);
      expect(Notice).toHaveBeenCalledWith("Cleared local semantic index.");
    });

    it("aborts clearing when the user declines the confirmation", async () => {
      mockConfirmBehavior.value = "cancel";
      const { plugin, commands } = makePlugin();
      registerCommands(plugin);

      await commands.find(({ id }) => id === COMMAND_IDS.CLEAR_LOCAL_SEMANTIC_INDEX)?.callback?.();
      await new Promise((resolve) => window.setTimeout(resolve, 100));

      expect(clearLocalEmbeddingIndex).not.toHaveBeenCalled();
    });

    it("refreshes the semantic index and reports the indexed note count", async () => {
      const { plugin, commands } = makePlugin();
      registerCommands(plugin);

      await commands
        .find(({ id }) => id === COMMAND_IDS.REFRESH_LOCAL_SEMANTIC_INDEX)
        ?.callback?.();
      await waitForMockCall(refreshLocalEmbeddingIndex as unknown as jest.Mock);

      expect(refreshLocalEmbeddingIndex).toHaveBeenCalledTimes(1);
      expect(Notice).toHaveBeenCalledWith("Local semantic index refreshed (2 notes indexed).");
    });

    it("rebuilds the semantic index after confirmation", async () => {
      const { plugin, commands } = makePlugin();
      registerCommands(plugin);

      await commands
        .find(({ id }) => id === COMMAND_IDS.REINDEX_LOCAL_SEMANTIC_INDEX)
        ?.callback?.();
      await waitForMockCall(reindexLocalEmbeddingIndex as unknown as jest.Mock);

      expect(reindexLocalEmbeddingIndex).toHaveBeenCalledTimes(1);
      expect(Notice).toHaveBeenCalledWith("Local semantic index rebuilt (2 notes indexed).");
    });

    it("writes a status report categorizing the vault files", async () => {
      const contents: Record<string, string> = {
        "a.md": "content",
        "b.md": "content",
        "c.md": "   ",
        "d.md": "content",
      };
      const fileInstances: Record<string, TFile> = {};
      for (const path of Object.keys(contents)) {
        fileInstances[path] = new (TFile as unknown as new (p: string) => TFile)(path);
      }
      const createdFiles: TFile[] = [];
      const create = jest.fn().mockImplementation(async (path: string) => {
        const file = new (TFile as unknown as new (p: string) => TFile)(path);
        createdFiles.push(file);
        return file;
      });
      const openFile = jest.fn().mockResolvedValue(undefined);
      const commands: Command[] = [];
      const plugin = {
        addCommand: jest.fn((command: Command) => commands.push(command)),
        app: {
          workspace: { getActiveFile: jest.fn(() => null), getLeaf: () => ({ openFile }) },
          vault: {
            getMarkdownFiles: () => Object.values(fileInstances),
            cachedRead: jest.fn(async (file: TFile) => contents[file.path] ?? ""),
            getAbstractFileByPath: jest.fn(
              (path: string) =>
                fileInstances[path] ?? createdFiles.find((file) => file.path === path) ?? null
            ),
            adapter: { mkdir: jest.fn().mockResolvedValue(undefined) },
            create,
            modify: jest.fn().mockResolvedValue(undefined),
          },
        },
      } as unknown as CopilotPlugin;

      jest
        .mocked(shouldIndexFile)
        .mockImplementation((_app: unknown, file: TFile) => file.path !== "d.md");
      jest.mocked(listIndexedNotes).mockReturnValue(["a.md"]);

      registerCommands(plugin);
      const command = commands.find(({ id }) => id === COMMAND_IDS.LIST_SEMANTIC_INDEXED_FILES);
      await command?.callback?.();
      await waitForMockCall(create);

      expect(create).toHaveBeenCalledTimes(1);
      const createCall = jest.mocked(create).mock.calls[0] as [string, string];
      expect(createCall[0].startsWith("Copilot/Copilot-Indexed-Files-")).toBe(true);
      expect(createCall[1]).toContain("- Indexed files: 1");
      expect(createCall[1]).toContain("- Unindexed files: 1");
      expect(createCall[1]).toContain("- Empty files: 1");
      expect(createCall[1]).toContain("- Excluded files: 1");
      expect(createCall[1]).toContain("- [[a.md]]");
      expect(createCall[1]).toContain("- [[b.md]]");
      expect(createCall[1]).toContain("- [[c.md]]");
      expect(createCall[1]).toContain("- [[d.md]]");
      expect(openFile).toHaveBeenCalledTimes(1);
    });
  });
});
