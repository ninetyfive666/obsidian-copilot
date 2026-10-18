/* eslint-disable obsidianmd/no-tfile-tfolder-cast -- test fixtures; not real TFiles */
jest.mock("obsidian", () => {
  const actual = jest.requireActual<Record<string, unknown>>("obsidian");
  const { StateField } =
    jest.requireActual<typeof import("@codemirror/state")>("@codemirror/state");
  return {
    ...actual,
    editorInfoField: StateField.define<unknown>({ create: () => null, update: (value) => value }),
    Plugin: class Plugin {},
    PluginSettingTab: class PluginSettingTab {},
    MarkdownView: class MarkdownView {},
  };
});
jest.mock("@/LLMProviders/chatModelManager", () => ({
  __esModule: true,
  default: { getInstance: jest.fn() },
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));
jest.mock("@/services/settingsPersistence", () => ({
  flushPersistence: jest.fn().mockResolvedValue(undefined),
  persistSettings: jest.fn(),
  loadSettingsWithKeychain: jest.fn(),
  resetPersistenceState: jest.fn(),
}));
jest.mock("@/logFileManager", () => ({
  logFileManager: { flush: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("@/state/vaultDataAtoms", () => ({
  VaultDataManager: { getInstance: jest.fn(() => ({ cleanup: jest.fn() })) },
}));
jest.mock("@/services/webViewerService/webViewerServiceSingleton", () => ({
  getWebViewerService: jest.fn(() => ({ stopActiveWebTabTracking: jest.fn() })),
  startActiveWebTabTracking: jest.fn(),
}));
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: jest.fn(() => false) }));
jest.mock("@/utils/notificationSound", () => ({ disposeNotificationSound: jest.fn() }));
jest.mock("@/utils/chatDeepLink", () => ({
  ...jest.requireActual<typeof import("@/utils/chatDeepLink")>("@/utils/chatDeepLink"),
  findChatFileByDeepLinkId: jest.fn(),
}));
import CopilotPlugin from "@/main";
import CopilotView from "@/components/CopilotView";
import { getSelectedTextContexts, setSelectedTextContexts } from "@/aiParams";
import { DEFAULT_SETTINGS } from "@/constants";
import { settingsAtom, settingsStore } from "@/settings/model";
import type { WebSelectionTrackingOptions } from "@/services/webViewerService/webViewerServiceSelection";
import { EditorView } from "@codemirror/view";
import type { Extension, StateField } from "@codemirror/state";
import { editorInfoField, type MarkdownFileInfo } from "obsidian";

const mockStartSelectionTracker = jest.fn();
const mockSelectionTrackerOptions = jest.fn();
jest.mock("@/services/webViewerService/webViewerServiceSelection", () => ({
  WebSelectionTracker: class {
    constructor(options: WebSelectionTrackingOptions) {
      mockSelectionTrackerOptions(options);
    }
    start = mockStartSelectionTracker;
  },
}));
import { logError, logInfo, logWarn } from "@/logger";
import { logFileManager } from "@/logFileManager";
import { flushPersistence } from "@/services/settingsPersistence";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { disposeNotificationSound } from "@/utils/notificationSound";
import { findChatFileByDeepLinkId } from "@/utils/chatDeepLink";
import { Notice, TFile, type WorkspaceLeaf } from "obsidian";

function createPluginUnderTest(calls: string[]) {
  const plugin = Object.create(CopilotPlugin.prototype) as CopilotPlugin;

  Object.assign(plugin, {
    app: { workspace: { getLeavesOfType: jest.fn(() => []) } },
    chatSelectionHighlightController: { cleanup: jest.fn(() => calls.push("highlight")) },
    customCommandRegister: { cleanup: jest.fn(() => calls.push("customCommands")) },
    systemPromptRegister: { cleanup: jest.fn(() => calls.push("systemPrompts")) },
    projectRegister: { cleanup: jest.fn(() => calls.push("projects")) },
    settingsUnsubscriber: jest.fn(() => calls.push("settings")),
    modelManagement: { dispose: jest.fn(() => calls.push("modelManagement")) },
    cleanupWebSelectionWatcher: jest.fn(),
  });

  return plugin;
}

async function flushTeardown(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("main", () => {
  describe("CopilotPlugin", () => {
    describe("copyChatLink()", () => {
      beforeEach(() => jest.clearAllMocks());

      it("copies a markdown link titled by the chat topic that targets the note's epoch", async () => {
        const plugin = createPluginUnderTest([]);
        const frontmatter = { epoch: 1735732800000, topic: "Trip planning" };
        Object.assign(plugin, {
          app: {
            vault: {
              getName: () => "My Vault",
              getAbstractFileByPath: (path: string) =>
                new (TFile as unknown as new (path: string) => TFile)(path),
            },
            metadataCache: {
              getCache: () => ({ frontmatter }),
              getFileCache: () => ({ frontmatter }),
            },
          },
        });
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

        await plugin.copyChatLink(async () => "Copilot/conversations/renamed.md");

        expect(writeText).toHaveBeenCalledWith(
          "[Trip planning](obsidian://copilot-chat?vault=My%20Vault&id=epoch%3A1735732800000)"
        );
      });

      it.each([
        ["returns no note", async () => ""],
        [
          "throws",
          async () => {
            throw new Error("disk full");
          },
        ],
      ])(
        "reports a failure and copies nothing when saving the chat %s https://github.com/Brevilabs/obsidian-copilot-private/issues/601",
        async (_, resolveNotePath) => {
          const plugin = createPluginUnderTest([]);
          const writeText = jest.fn().mockResolvedValue(undefined);
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
          });

          await plugin.copyChatLink(resolveNotePath);

          expect(writeText).not.toHaveBeenCalled();
          expect(Notice).toHaveBeenCalledWith("Could not copy chat link.");
        }
      );
    });

    describe("openChatDeepLink()", () => {
      beforeEach(() => jest.clearAllMocks());

      it("loads the note resolved from an epoch id through the existing loader", async () => {
        const plugin = createPluginUnderTest([]);
        jest.mocked(findChatFileByDeepLinkId).mockResolvedValue({
          path: "Copilot/conversations/renamed.md",
        } as unknown as TFile);
        const load = jest.spyOn(plugin, "loadChatById").mockResolvedValue(undefined);

        await plugin.openChatDeepLink({ action: "copilot-chat", id: "epoch:1735732800000" });

        expect(findChatFileByDeepLinkId).toHaveBeenCalledWith(plugin.app, "epoch:1735732800000");
        expect(load).toHaveBeenCalledWith("Copilot/conversations/renamed.md");
      });

      it("resumes a native agent session id without looking for a note", async () => {
        const plugin = createPluginUnderTest([]);
        const load = jest.spyOn(plugin, "loadChatById").mockResolvedValue(undefined);

        await plugin.openChatDeepLink({ id: "copilot-agent-session://codex/abc" });

        expect(findChatFileByDeepLinkId).not.toHaveBeenCalled();
        expect(load).toHaveBeenCalledWith("copilot-agent-session://codex/abc");
      });

      it("does not load anything when the id resolves to no note", async () => {
        const plugin = createPluginUnderTest([]);
        jest.mocked(findChatFileByDeepLinkId).mockResolvedValue(null);
        const load = jest.spyOn(plugin, "loadChatById").mockResolvedValue(undefined);

        await plugin.openChatDeepLink({ id: "Copilot/conversations/private.md" });

        expect(load).not.toHaveBeenCalled();
      });
    });

    describe("initSelectionHandler()", () => {
      beforeEach(() => {
        jest.useFakeTimers();
        setSelectedTextContexts([]);
      });
      afterEach(() => {
        jest.useRealTimers();
        setSelectedTextContexts([]);
      });

      it("attaches Reading view text after the debounce even when chat takes the selection first, then clears it in the note (https://github.com/Brevilabs/obsidian-copilot-private/issues/597)", () => {
        const preview = document.createElement("div");
        preview.textContent = "Excerpt from the note";
        const chat = document.createElement("div");
        chat.textContent = "Chat input";
        document.body.append(preview, chat);
        const noteView = {
          file: { path: "Research.md", basename: "Research" },
          getMode: () => "preview",
          previewMode: { containerEl: preview },
        };
        const cleanups: Array<() => void> = [];
        const plugin = Object.create(CopilotPlugin.prototype) as CopilotPlugin;
        Object.assign(plugin, {
          registerEditorExtension: jest.fn(),
          registerDomEvent: (doc: Document, event: string, handler: EventListener) => {
            doc.addEventListener(event, handler);
            cleanups.push(() => doc.removeEventListener(event, handler));
          },
          registerEvent: jest.fn(),
          app: { workspace: { getActiveViewOfType: () => noteView, on: jest.fn() } },
        });
        const select = (node: Node, end: number) => {
          const range = document.createRange();
          range.setStart(node, 0);
          range.setEnd(node, end);
          const selection = document.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
        };

        plugin.initSelectionHandler();
        select(preview.firstChild!, 7);
        select(chat.firstChild!, 0);
        expect(getSelectedTextContexts()).toEqual([]);
        jest.advanceTimersByTime(500);
        expect(getSelectedTextContexts()).toEqual([
          expect.objectContaining({
            content: "Excerpt",
            notePath: "Research.md",
            startLine: 0,
            endLine: 0,
          }),
        ]);

        select(preview.firstChild!, 0);
        jest.advanceTimersByTime(500);
        expect(getSelectedTextContexts()).toEqual([]);

        document.getSelection()!.removeAllRanges();
        cleanups.forEach((cleanup) => cleanup());
        preview.remove();
        chat.remove();
      });

      it("attaches and clears a note excerpt from the focused editor's own note after the debounce (https://github.com/Brevilabs/obsidian-copilot-private/issues/597)", () => {
        let extension: Extension | undefined;
        const plugin = Object.create(CopilotPlugin.prototype) as CopilotPlugin;
        Object.assign(plugin, {
          registerEditorExtension: (value: Extension) => {
            extension = value;
          },
          registerDomEvent: jest.fn(),
          registerEvent: jest.fn(),
          app: { workspace: { on: jest.fn() } },
        });
        plugin.initSelectionHandler();
        const noteInfo = {
          file: { path: "Research.md", basename: "Research" },
          editor: {
            listSelections: () => [
              {
                anchor: { line: 0, ch: cm.state.selection.main.anchor },
                head: { line: 0, ch: cm.state.selection.main.head },
              },
            ],
            getSelection: () =>
              cm.state.sliceDoc(cm.state.selection.main.from, cm.state.selection.main.to),
          },
        } as unknown as MarkdownFileInfo;
        const cm = new EditorView({
          doc: "Excerpt from the note",
          parent: document.body,
          extensions: [
            extension!,
            (editorInfoField as unknown as StateField<unknown>).init(() => noteInfo),
          ],
        });

        cm.focus();
        cm.dispatch({ selection: { anchor: 0, head: 3 } });
        cm.dispatch({ selection: { anchor: 0, head: 7 } });
        jest.advanceTimersByTime(500);
        expect(getSelectedTextContexts()).toEqual([
          expect.objectContaining({ content: "Excerpt", notePath: "Research.md" }),
        ]);

        cm.dispatch({ selection: { anchor: 7 } });
        jest.advanceTimersByTime(500);
        expect(getSelectedTextContexts()).toEqual([]);
        cm.destroy();
      });
    });

    describe("handleSelectionChange()", () => {
      it("automatically attaches a note excerpt even when the retired preferences were saved as false", () => {
        settingsStore.set(settingsAtom, {
          ...DEFAULT_SETTINGS,
          ...{ autoAddSelectionToContext: false, autoIncludeTextSelection: false },
        });
        setSelectedTextContexts([]);
        const plugin = Object.create(CopilotPlugin.prototype) as CopilotPlugin;

        plugin.handleSelectionChange({
          file: { path: "Research.md", basename: "Research" },
          editor: {
            listSelections: () => [{ anchor: { line: 1, ch: 0 }, head: { line: 2, ch: 7 } }],
            getSelection: () => "An excerpt from the note.",
          },
        } as unknown as MarkdownFileInfo);

        expect(getSelectedTextContexts()).toEqual([
          expect.objectContaining({
            content: "An excerpt from the note.",
            sourceType: "note",
            notePath: "Research.md",
            startLine: 2,
            endLine: 3,
          }),
        ]);
        setSelectedTextContexts([]);
      });
    });

    describe("initWebSelectionWatcher()", () => {
      it("enables desktop web selection tracking even when the retired preference was saved as false", () => {
        settingsStore.set(settingsAtom, {
          ...DEFAULT_SETTINGS,
          ...{ autoAddSelectionToContext: false, autoIncludeTextSelection: false },
        });
        (isDesktopRuntime as jest.Mock).mockReturnValue(true);
        const plugin = Object.create(CopilotPlugin.prototype) as CopilotPlugin;
        Object.assign(plugin, { app: {} });

        plugin.initWebSelectionWatcher();

        const options = mockSelectionTrackerOptions.mock.calls.at(
          -1
        )![0] as WebSelectionTrackingOptions;
        expect(options.isEnabled()).toBe(true);
        expect(mockStartSelectionTracker).toHaveBeenCalled();
        (isDesktopRuntime as jest.Mock).mockReturnValue(false);
      });
    });

    describe("addNoteToActiveChat()", () => {
      beforeEach(() => {
        jest.clearAllMocks();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 opens the Copilot chat before inserting when no chat leaf exists yet", async () => {
        (isDesktopRuntime as jest.Mock).mockReturnValue(false);
        const plugin = createPluginUnderTest([]);
        const view = Object.assign(Object.create(CopilotView.prototype) as CopilotView, {
          eventTarget: { queueInsertText: jest.fn() },
        });
        const leaf = { view } as unknown as WorkspaceLeaf;
        const revealLeaf = jest.fn();
        const activateView = jest.fn().mockResolvedValue(undefined);
        Object.assign(plugin, {
          activateView,
          app: {
            workspace: {
              getLeavesOfType: jest.fn().mockReturnValueOnce([]).mockReturnValue([leaf]),
              revealLeaf,
            },
          },
        });
        const note = Object.assign(new TFile(), {
          path: "Notes/Research.md",
          basename: "Research",
        });

        await plugin.addNoteToActiveChat(note);

        expect(activateView).toHaveBeenCalledTimes(1);
        expect(revealLeaf).toHaveBeenCalledWith(leaf);
        expect(view.eventTarget.queueInsertText).toHaveBeenCalledWith("[[Research]]");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 reveals the open Copilot chat and inserts a wikilink", async () => {
        (isDesktopRuntime as jest.Mock).mockReturnValue(false);
        const plugin = createPluginUnderTest([]);
        const view = Object.assign(Object.create(CopilotView.prototype) as CopilotView, {
          eventTarget: { queueInsertText: jest.fn() },
        });
        const leaf = { view } as unknown as WorkspaceLeaf;
        const revealLeaf = jest.fn();
        Object.assign(plugin, {
          app: { workspace: { getLeavesOfType: jest.fn(() => [leaf]), revealLeaf } },
        });
        const note = Object.assign(new TFile(), {
          path: "Notes/Research.md",
          basename: "Research",
        });

        await plugin.addNoteToActiveChat(note);

        expect(revealLeaf).toHaveBeenCalledWith(leaf);
        expect(view.eventTarget.queueInsertText).toHaveBeenCalledWith("[[Research]]");
      });
    });

    describe("onunload()", () => {
      beforeEach(() => {
        jest.clearAllMocks();
        (disposeNotificationSound as jest.Mock).mockReset();
        (flushPersistence as jest.Mock).mockResolvedValue(undefined);
        (logFileManager.flush as jest.Mock).mockResolvedValue(undefined);
        (isDesktopRuntime as jest.Mock).mockReturnValue(false);
      });

      it("returns void so Obsidian's non-awaiting unload cannot drop the teardown promise", () => {
        const plugin = createPluginUnderTest([]);

        expect(plugin.onunload()).toBeUndefined();
      });

      it("revokes lifecycle-sensitive mutations before returning (https://github.com/Brevilabs/obsidian-copilot-private/issues/284)", () => {
        const plugin = createPluginUnderTest([]);
        Object.assign(plugin, { pluginLifecycleActive: true });
        expect(plugin.isPluginLifecycleActive()).toBe(true);

        plugin.onunload();

        expect(plugin.isPluginLifecycleActive()).toBe(false);
      });

      it("flushes persistence synchronously, before returning to Obsidian", () => {
        const calls: string[] = [];
        const plugin = createPluginUnderTest(calls);

        plugin.onunload();

        expect(flushPersistence).toHaveBeenCalledTimes(1);
        expect(calls).toEqual([]);
      });

      it("releases audio before asynchronous teardown can overlap a later plugin lifecycle (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
        const calls: string[] = [];
        let releasePersistence: () => void = () => undefined;
        (disposeNotificationSound as jest.Mock).mockImplementation(() => calls.push("audio"));
        (flushPersistence as jest.Mock).mockImplementation(() => {
          calls.push("persistence");
          return new Promise<void>((resolve) => {
            releasePersistence = resolve;
          });
        });
        const plugin = createPluginUnderTest(calls);

        plugin.onunload();

        expect(calls).toEqual(["audio", "persistence"]);
        releasePersistence();
        await flushTeardown();
      });

      it("tears down collaborators in order, flushing persistence before session shutdown and the log last", async () => {
        const calls: string[] = [];
        const plugin = createPluginUnderTest(calls);
        (flushPersistence as jest.Mock).mockImplementation(async () => {
          calls.push("persistence");
        });
        (logFileManager.flush as jest.Mock).mockImplementation(async () => {
          calls.push("logFlush");
        });

        plugin.onunload();
        await flushTeardown();

        expect(calls).toEqual([
          "persistence",
          "highlight",
          "customCommands",
          "systemPrompts",
          "projects",
          "settings",
          "modelManagement",
          "logFlush",
        ]);
        expect(logInfo).toHaveBeenCalledWith("Copilot plugin unloaded");
      });

      it("completes teardown when onload never assigned its collaborators", async () => {
        const calls: string[] = [];
        const plugin = createPluginUnderTest(calls);
        Object.assign(plugin, {
          chatSelectionHighlightController: undefined,
          customCommandRegister: undefined,
          systemPromptRegister: undefined,
          projectRegister: undefined,
          settingsUnsubscriber: undefined,
          modelManagement: undefined,
        });

        plugin.onunload();
        await flushTeardown();

        expect(logError).not.toHaveBeenCalled();
        expect(logInfo).toHaveBeenCalledWith("Copilot plugin unloaded");
      });

      it("logs a teardown rejection instead of leaving an unhandled promise rejection", async () => {
        const plugin = createPluginUnderTest([]);
        const failure = new Error("dispose failed");
        (plugin.modelManagement as unknown as { dispose: jest.Mock }).dispose.mockImplementation(
          () => {
            throw failure;
          }
        );

        plugin.onunload();
        await flushTeardown();

        expect(logError).toHaveBeenCalledWith(
          "Copilot: plugin teardown failed during unload:",
          failure
        );
      });
    });
  });
});
