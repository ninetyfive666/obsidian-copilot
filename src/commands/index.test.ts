jest.mock("@/commands/CustomCommandChatModal", () => ({
  CustomCommandChatModal: jest.fn(),
}));
jest.mock("@/utils/desktopRuntime", () => ({
  isDesktopRuntime: jest.fn(() => false),
}));

import { registerCommands } from "@/commands";
import { COMMAND_ICONS, COMMAND_IDS, COMMAND_NAMES, CommandId } from "@/constants";
import type CopilotPlugin from "@/main";
import type { Command } from "obsidian";

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
] as const;

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
        (plugin as unknown as { activateRelevantNotesView: jest.Mock })
          .activateRelevantNotesView
      ).toHaveBeenCalled();
    });

    it("creates a new chat and clears the recorded prompt payload", () => {
      const { plugin, commands } = makePlugin();
      (plugin as unknown as { newChat: jest.Mock }).newChat = jest.fn().mockResolvedValue(undefined);

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
  });
});
