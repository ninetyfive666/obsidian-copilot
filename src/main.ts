import { releaseCursorAssociation } from "@/editor/releaseCursorAssociation";
import { registerNoteHeaderAction } from "@/editor/registerNoteHeaderAction";
import { isNativeChatId } from "@/utils/nativeChatId";
import {
  buildChatDeepLink,
  buildChatMarkdownLink,
  findChatFileByDeepLinkId,
  getSavedChatDeepLinkId,
} from "@/utils/chatDeepLink";
import ChainOwner from "@/LLMProviders/chainOwner";
import { CustomModel, setSelectedTextContexts, getSelectedTextContexts } from "@/aiParams";
import { NoteSelectedTextContext, SelectedTextContext } from "@/types/message";
import { registerCommands } from "@/commands";
import CopilotView from "@/components/CopilotView";
import RelevantNotesView from "@/components/RelevantNotesView";
import { APPLY_VIEW_TYPE, ApplyView } from "@/components/composer/ApplyView";
import { LoadChatHistoryModal } from "@/components/modals/LoadChatHistoryModal";

import { registerContextMenu } from "@/commands/contextMenu";
import { CustomCommandRegister } from "@/commands/customCommandRegister";
import { migrateCommands } from "@/commands/migrator";
import { migrateSystemPromptsFromSettings } from "@/system-prompts/migration";
import { SystemPromptRegister } from "@/system-prompts/systemPromptRegister";
import { ProjectRegister } from "@/projects/projectRegister";
import {
  ABORT_REASON,
  CHAT_VIEWTYPE,
  DEFAULT_OPEN_AREA,
  EVENT_NAMES,
  RELEVANT_NOTES_VIEWTYPE,
} from "@/constants";
import { ChatManager } from "@/core/ChatManager";
import { MessageRepository } from "@/core/MessageRepository";
import { logError, logInfo, logWarn } from "@/logger";
import { logFileManager } from "@/logFileManager";
import { createModelManagement, type ModelManagementApi } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { backupLegacyCredentials } from "@/services/legacyCredentialBackup";
import {
  persistSettings,
  loadSettingsWithKeychain,
  flushPersistence,
  resetPersistenceState,
} from "@/services/settingsPersistence";
import { UserMemoryManager } from "@/memory/UserMemoryManager";
import { clearRecordedPromptPayload } from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";
import {
  getWebViewerService,
  startActiveWebTabTracking,
} from "@/services/webViewerService/webViewerServiceSingleton";
import { WebSelectionTracker } from "@/services/webViewerService/webViewerServiceSelection";
import { CopilotSettingTab } from "@/settings/SettingsPage";
import {
  getModelKeyFromModel,
  getSettings,
  setSettings,
  subscribeToSettingsChange,
} from "@/settings/model";
import { getEffectiveConversationsFolder } from "@/settings/copilotFolder";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { disposeNotificationSound } from "@/utils/notificationSound";
import { installRendererEventsShim } from "@/utils/rendererEventsShim";
import { ContextProcessor } from "@/contextProcessor";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { ChatManagerChatUIState } from "@/state/ChatUIState";
import { VaultDataManager } from "@/state/vaultDataAtoms";
import { FileParserManager } from "@/tools/FileParserManager";
import { initializeBuiltinTools } from "@/tools/builtinTools";
import {
  ChatSelectionHighlightController,
  hideChatSelectionHighlight,
  QuickAskController,
  SelectionHighlight,
} from "@/editor";
import {
  Editor,
  editorInfoField,
  MarkdownFileInfo,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TFile,
  ViewCreator,
  WorkspaceLeaf,
} from "obsidian";
import { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import {
  extractChatLastAccessedAtMs,
  extractChatTitle,
  fileToHistoryItem,
  filterChatHistoryFiles,
} from "@/utils/chatHistoryUtils";
import { RecentUsageManager } from "@/utils/recentUsageManager";
import {
  listMarkdownFiles,
  patchFrontmatter,
  resolveFileByPath,
  trashFile,
} from "@/utils/vaultAdapterUtils";
import { v4 as uuidv4 } from "uuid";
import { EditorView } from "@codemirror/view";

export default class CopilotPlugin extends Plugin {
  chainOwner: ChainOwner;
  userMessageHistory: string[] = [];
  fileParserManager: FileParserManager;
  customCommandRegister: CustomCommandRegister;
  systemPromptRegister: SystemPromptRegister;
  projectRegister: ProjectRegister;
  settingsUnsubscriber?: () => void;
  chatUIState: ChatManagerChatUIState;
  modelManagement!: ModelManagementApi;
  private ribbonIconEl?: HTMLElement;
  userMemoryManager: UserMemoryManager;
  quickAskController: QuickAskController;
  chatSelectionHighlightController: ChatSelectionHighlightController;
  private selectionDebounceTimer?: number;
  private lastSelectionSignature?: string;
  private webSelectionTracker?: WebSelectionTracker;
  private readonly chatHistoryLastAccessedAtManager = new RecentUsageManager<string>();
  private pluginLifecycleActive = true;

  public isPluginLifecycleActive(): boolean {
    return this.pluginLifecycleActive;
  }

  async onload(): Promise<void> {
    installRendererEventsShim();
    resetPersistenceState();
    KeychainService.resetInstance();
    KeychainService.getInstance(this.app);
    await this.loadSettings();
    this.modelManagement = createModelManagement({
      app: this.app,
    });
    this.settingsUnsubscriber = subscribeToSettingsChange((prev, next) => {
      void (async () => {
        try {
          await persistSettings(next, (data) => this.saveData(data), prev);
        } catch (error) {
          logError("Failed to persist settings.", error);
          new Notice("Copilot failed to save settings. Check logs and try again.");
        }
      })();
    });
    this.addSettingTab(new CopilotSettingTab(this.app, this));

    initializeBuiltinTools(this.app);

    ContextProcessor.getInstance(this.app);
    CustomCommandManager.getInstance(this.app);
    logFileManager.setApp(this.app);

    this.chainOwner = ChainOwner.getInstance(this.app, this.modelManagement);

    const vaultDataManager = VaultDataManager.getInstance();
    vaultDataManager.initialize(this.app);

    this.fileParserManager = new FileParserManager(this.app.vault);

    const messageRepo = new MessageRepository();
    const chainManager = this.chainOwner.getCurrentChainManager();
    const chatManager = new ChatManager(messageRepo, chainManager, this.fileParserManager, this);
    this.chatUIState = new ChatManagerChatUIState(chatManager);

    this.userMemoryManager = new UserMemoryManager(this.app);

    this.quickAskController = new QuickAskController(this);
    this.registerEditorExtension(this.quickAskController.createExtension());
    this.registerEditorExtension(releaseCursorAssociation);

    this.chatSelectionHighlightController = new ChatSelectionHighlightController(this, {
      closeQuickAskOnChatFocus: false,
    });
    this.chatSelectionHighlightController.initialize();

    if (isDesktopRuntime()) {
      const { activeLeafRef, layoutRef } = startActiveWebTabTracking(this.app, {
        preserveOnViewTypes: [CHAT_VIEWTYPE],
      });
      this.registerEvent(activeLeafRef);
      this.registerEvent(layoutRef);
    }

    if (isDesktopRuntime()) registerNoteHeaderAction(this);

    this.safeRegisterView(CHAT_VIEWTYPE, (leaf: WorkspaceLeaf) => new CopilotView(leaf, this));
    this.safeRegisterView(APPLY_VIEW_TYPE, (leaf: WorkspaceLeaf) => new ApplyView(leaf));
    this.safeRegisterView(
      RELEVANT_NOTES_VIEWTYPE,
      (leaf: WorkspaceLeaf) => new RelevantNotesView(leaf, this)
    );

    this.initActiveLeafChangeHandler();

    this.ribbonIconEl = this.addRibbonIcon("message-square", "Open Copilot Chat", () =>
      this.activateView()
    );

    registerCommands(this);

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu) => {
        registerContextMenu(menu, this.app);
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.chatSelectionHighlightController.handleActiveLeafChange(leaf ?? null);
      })
    );

    this.customCommandRegister = new CustomCommandRegister(this, this.app);
    this.systemPromptRegister = new SystemPromptRegister(this.app);
    this.projectRegister = new ProjectRegister(this.app);

    this.app.workspace.onLayoutReady(() => {
      void this.initializeAuxiliaryRegisters();
    });

    this.initSelectionHandler();

    this.initWebSelectionWatcher();

    // A queued URI may fire as soon as its handler is registered, so register
    // after chat managers and views are ready to load a conversation.
    // https://github.com/logancyang/obsidian-copilot/issues/3271
    this.registerObsidianProtocolHandler("copilot-chat", (params) => {
      void this.openChatDeepLink(params);
    });
  }

  private async initializeAuxiliaryRegisters(): Promise<void> {
    const results = await Promise.allSettled([
      this.projectRegister.initialize(),
      this.customCommandRegister.initialize().then(() => migrateCommands(this.app)),
      this.systemPromptRegister.initialize().then(() => migrateSystemPromptsFromSettings(this.app)),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        logError("Copilot failed to finish a startup register", result.reason);
      }
    }
  }

  private safeRegisterView(type: string, viewCreator: ViewCreator): void {
    try {
      this.registerView(type, viewCreator);
    } catch (error) {
      logWarn(`Copilot: view type "${type}" already registered; skipping re-registration.`, error);
    }
  }

  onunload(): void {
    this.pluginLifecycleActive = false;
    // The audio module is shared across hot-reloaded plugin instances, so the outgoing
    // teardown must release its context before a successor can create one. https://github.com/logancyang/obsidian-copilot/issues/2987
    disposeNotificationSound();
    this.teardown().catch((error) => {
      logError("Copilot: plugin teardown failed during unload:", error);
    });
  }

  private async teardown(): Promise<void> {
    await flushPersistence();

    this.clearAllPersistentSelectionHighlights();

    this.chatSelectionHighlightController?.cleanup();

    const vaultDataManager = VaultDataManager.getInstance();
    vaultDataManager.cleanup();

    this.customCommandRegister?.cleanup();
    this.systemPromptRegister?.cleanup();
    this.projectRegister?.cleanup();
    this.settingsUnsubscriber?.();

    window.clearTimeout(this.selectionDebounceTimer);
    this.cleanupWebSelectionWatcher();
    this.clearSelectionContext();

    try {
      const webViewerService = getWebViewerService(this.app);
      webViewerService.stopActiveWebTabTracking();
    } catch (error) {
      logWarn("Could not stop web tab tracking", error);
    }

    this.modelManagement?.dispose();

    await logFileManager.flush();
    logInfo("Copilot plugin unloaded");
  }

  private clearAllPersistentSelectionHighlights(): void {
    try {
      const leaves = this.app.workspace.getLeavesOfType("markdown");
      for (const leaf of leaves) {
        const view = leaf.view;
        if (!(view instanceof MarkdownView)) continue;
        const cm = view.editor?.cm;
        if (cm) {
          SelectionHighlight.hide(cm);
          hideChatSelectionHighlight(cm);
        }
      }
    } catch (error) {
      logWarn("Failed to clear persistent selection highlights:", error);
    }
  }

  updateUserMessageHistory(newMessage: string) {
    this.userMessageHistory = [...this.userMessageHistory, newMessage];
  }

  async autosaveCurrentChat() {
    if (getSettings().autosaveChat) {
      const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]?.view as CopilotView;
      if (chatView) {
        await chatView.saveChat();
      }
    }
  }

  async processText(
    editor: Editor,
    eventType: string,
    eventSubtype?: string,
    checkSelectedText = true
  ) {
    const selectedText = editor.getSelection();

    const isChatWindowActive = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE).length > 0;

    if (!isChatWindowActive) {
      await this.activateView();
    }

    window.setTimeout(() => {
      const activeCopilotView = this.app.workspace
        .getLeavesOfType(CHAT_VIEWTYPE)
        .find((leaf) => leaf.view instanceof CopilotView)?.view as CopilotView;
      if (activeCopilotView && (!checkSelectedText || selectedText)) {
        const event = new CustomEvent(eventType, { detail: { selectedText, eventSubtype } });
        activeCopilotView.eventTarget.dispatchEvent(event);
      }
    }, 0);
  }

  processSelection(editor: Editor, eventType: string, eventSubtype?: string) {
    void this.processText(editor, eventType, eventSubtype);
  }

  emitChatIsVisible(viewType: string = CHAT_VIEWTYPE) {
    const view = this.app.workspace
      .getLeavesOfType(viewType)
      .map((leaf) => leaf.view)
      .find((v): v is CopilotView => v instanceof CopilotView);

    if (view) {
      view.eventTarget.dispatchEvent(new CustomEvent(EVENT_NAMES.CHAT_IS_VISIBLE));
    }
  }

  initActiveLeafChangeHandler() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf) {
          return;
        }
        const activeViewType = leaf.getViewState().type;
        if (activeViewType === CHAT_VIEWTYPE) {
          this.emitChatIsVisible(activeViewType);
        }
      })
    );
  }

  initSelectionHandler() {
    this.registerEditorExtension(
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet || !update.view.hasFocus) return;

        // The originating editor identifies its note even in a popout, where
        // the active leaf may differ. https://github.com/Brevilabs/obsidian-copilot-private/issues/597
        const info = update.state.field(editorInfoField, false);
        if (info) this.scheduleSelectionUpdate(() => this.handleSelectionChange(info));
      })
    );

    const watchDocument = (doc: Document) =>
      this.registerDomEvent(doc, "selectionchange", () => this.handleReadingSelectionChange(doc));
    watchDocument(activeDocument);
    this.registerEvent(this.app.workspace.on("window-open", (win) => watchDocument(win.doc)));
  }

  private scheduleSelectionUpdate(update: () => void): void {
    window.clearTimeout(this.selectionDebounceTimer);
    this.selectionDebounceTimer = window.setTimeout(update, 500);
  }

  private handleReadingSelectionChange(doc: Document): void {
    const selection = doc.getSelection();
    const anchor = selection?.anchorNode;
    const focus = selection?.focusNode;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!anchor || !focus || !file || view.getMode() !== "preview") return;

    // Only rendered text inside the note is a note selection; a later chat
    // selection leaves the pending one attached. https://github.com/Brevilabs/obsidian-copilot-private/issues/597
    const readingEl = view.previewMode.containerEl;
    if (!readingEl.contains(anchor) || !readingEl.contains(focus)) return;

    const selectedText = selection.toString();
    this.scheduleSelectionUpdate(() => {
      const signature = `preview:${file.path}:${selectedText}`;
      if (signature === this.lastSelectionSignature) return;
      this.lastSelectionSignature = signature;

      if (!selectedText.trim()) {
        this.clearNoteSelectionContexts();
        return;
      }

      // Rendered Markdown does not expose reliable source line numbers for every selection.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/597
      this.setSelectionContext({
        id: uuidv4(),
        content: selectedText,
        sourceType: "note",
        noteTitle: file.basename,
        notePath: file.path,
        startLine: 0,
        endLine: 0,
      });
    });
  }

  private clearNoteSelectionContexts(): void {
    const currentContexts = getSelectedTextContexts();
    const nonNoteContexts = currentContexts.filter((ctx) => ctx.sourceType !== "note");
    if (currentContexts.length !== nonNoteContexts.length) {
      setSelectedTextContexts(nonNoteContexts);
    }
  }

  private clearSelectionContext() {
    setSelectedTextContexts([]);
  }

  private clearWebSelectionContextForUrl(url: string): void {
    const current = getSelectedTextContexts();
    const next = current.filter((c) => c.sourceType !== "web" || c.url !== url);
    if (next.length === current.length) {
      return;
    }
    setSelectedTextContexts(next);
  }

  private setSelectionContext(context: SelectedTextContext) {
    setSelectedTextContexts([context]);
  }

  handleSelectionChange({ editor, file }: MarkdownFileInfo) {
    const selectionRange = editor?.listSelections()[0];
    if (!editor || !selectionRange) {
      return;
    }

    const signature = file
      ? `${file.path}:${selectionRange.anchor.line}:${selectionRange.anchor.ch}:${selectionRange.head.line}:${selectionRange.head.ch}`
      : "";

    if (signature === this.lastSelectionSignature) {
      return;
    }
    this.lastSelectionSignature = signature;

    const selectedText = editor.getSelection();

    if (!selectedText || !selectedText.trim()) {
      this.clearNoteSelectionContexts();
      return;
    }

    if (!file) {
      return;
    }

    const anchorLine = selectionRange.anchor.line + 1;
    const headLine = selectionRange.head.line + 1;
    const startLine = Math.min(anchorLine, headLine);
    const endLine = Math.max(anchorLine, headLine);

    const selectedTextContext: NoteSelectedTextContext = {
      id: uuidv4(),
      content: selectedText,
      sourceType: "note",
      noteTitle: file.basename,
      notePath: file.path,
      startLine,
      endLine,
    };

    this.setSelectionContext(selectedTextContext);
  }

  initWebSelectionWatcher() {
    if (!isDesktopRuntime()) {
      return;
    }

    const webViewerService = getWebViewerService(this.app);

    this.webSelectionTracker = new WebSelectionTracker({
      intervalMs: 500,
      emptySelectionDebounceCount: 2,
      isEnabled: () => true,
      getLeaf: () => webViewerService.getActiveLeaf() ?? webViewerService.getLastActiveLeaf(),
      getActiveLeaf: () => webViewerService.getActiveLeaf(),
      onSelectionChange: (context) => {
        this.setSelectionContext(context);
      },
      onSelectionClear: ({ url }) => {
        this.clearWebSelectionContextForUrl(url);
      },
    });

    this.webSelectionTracker.start();
  }

  cleanupWebSelectionWatcher() {
    this.webSelectionTracker?.stop();
    this.webSelectionTracker = undefined;
  }

  suppressCurrentWebSelection(url?: string): void {
    if (url && url.trim()) {
      this.webSelectionTracker?.suppressSelectionForUrl(url);
      return;
    }

    this.webSelectionTracker?.suppressCurrentSelection();
  }

  private getCurrentEditorOrDummy(): Editor {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    return {
      getSelection: () => {
        const selection = activeView?.editor?.getSelection();
        if (selection) return selection;
        const activeFile = this.app.workspace.getActiveFile();
        return activeFile ? this.app.vault.read(activeFile) : "";
      },
      replaceSelection: activeView?.editor?.replaceSelection.bind(activeView.editor) || (() => {}),
    } as Partial<Editor> as Editor;
  }

  processCustomPrompt(eventType: string, customPrompt: string) {
    const editor = this.getCurrentEditorOrDummy();
    void this.processText(editor, eventType, customPrompt, false);
  }

  toggleView() {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE);
    if (leaves.length > 0) {
      void this.deactivateView();
    } else {
      void this.activateView();
    }
  }

  async activateView(): Promise<void> {
    await this.openOrRevealView(CHAT_VIEWTYPE);
    window.setTimeout(() => {
      this.emitChatIsVisible();
    }, 50);
  }

  async activateChatViewForContext(): Promise<void> {
    await this.activateView();
  }

  async deactivateView() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
  }

  async activateRelevantNotesView(): Promise<WorkspaceLeaf | null> {
    return this.openOrRevealView(RELEVANT_NOTES_VIEWTYPE);
  }

  async addNoteToActiveChat(note: TFile): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0] ?? null;
    if (!leaf) {
      await this.activateView();
      leaf = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0] ?? null;
    }
    if (!leaf) return;

    this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof CopilotView) {
      leaf.view.eventTarget.queueInsertText(`[[${note.basename}]]`);
    }
  }

  private async openOrRevealView(
    viewType: string,
    openInRightSidebar = false
  ): Promise<WorkspaceLeaf | null> {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      return leaves[0];
    }
    const leaf =
      openInRightSidebar || getSettings().defaultOpenArea === DEFAULT_OPEN_AREA.VIEW
        ? this.app.workspace.getRightLeaf(false)
        : this.app.workspace.getLeaf(true);
    if (!leaf) return null;
    await leaf.setViewState({ type: viewType, active: true });
    // A new right-sidebar leaf can exist while the sidebar remains collapsed.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/579
    if (openInRightSidebar) this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  async loadSettings() {
    const rawData = (await this.loadData()) as unknown;
    // The keychain bootstrap may persist a sparse snapshot of the raw on-disk
    // data (vaultId backfill) before settings are hydrated. That snapshot is
    // already in dehydrated, on-disk shape, so it must bypass the
    // `dehydrateDeviceProfile` override below via `super.saveData` — routing it
    // through `this.saveData` would read the absent flat fields as "cleared"
    // and delete this device's `deviceProfiles` segment
    // (https://github.com/logancyang/obsidian-copilot/issues/2539).
    const settings = await loadSettingsWithKeychain(
      rawData,
      (d) => this.saveData(d),
      (raw) =>
        backupLegacyCredentials(raw, this.manifest.dir ?? "", {
          exists: (path) => this.app.vault.adapter.exists(path),
          write: (path, contents) => this.app.vault.adapter.write(path, contents),
          rename: (from, to) => this.app.vault.adapter.rename(from, to),
        })
    );
    setSettings(settings);
  }

  mergeActiveModels(
    existingActiveModels: CustomModel[],
    builtInModels: CustomModel[]
  ): CustomModel[] {
    const modelMap = new Map<string, CustomModel>();

    existingActiveModels.forEach((model) => {
      const key = getModelKeyFromModel(model);
      const existingModel = modelMap.get(key);
      if (existingModel) {
        modelMap.set(key, {
          ...model,
          isBuiltIn: existingModel.isBuiltIn || model.isBuiltIn,
        });
      } else {
        modelMap.set(key, model);
      }
    });

    return Array.from(modelMap.values());
  }

  async loadCopilotChatHistory() {
    const chatFiles = await this.getChatHistoryFiles();
    if (chatFiles.length === 0) {
      new Notice("No chat history found.");
      return;
    }
    new LoadChatHistoryModal(
      this.app,
      chatFiles,
      this.chatHistoryLastAccessedAtManager,
      (file) => void this.loadChatHistory(file)
    ).open();
  }

  async getChatHistoryFiles(): Promise<TFile[]> {
    const folderFiles = await listMarkdownFiles(this.app, getEffectiveConversationsFolder());
    if (folderFiles.length === 0) return [];

    return filterChatHistoryFiles(this.app, folderFiles);
  }

  async getChatHistoryItems(): Promise<ChatHistoryItem[]> {
    const files = await this.getChatHistoryFiles();
    return files.map((file) =>
      fileToHistoryItem(this.app, file, this.chatHistoryLastAccessedAtManager)
    );
  }

  private async touchChatHistoryLastAccessedAt(file: TFile): Promise<void> {
    try {
      this.chatHistoryLastAccessedAtManager.touch(file.path);

      const persistedLastAccessedAtMs = extractChatLastAccessedAtMs(this.app, file);
      const timestampToPersist = this.chatHistoryLastAccessedAtManager.shouldPersist(
        file.path,
        persistedLastAccessedAtMs
      );

      if (timestampToPersist === null) {
        return;
      }

      let persistedAtMs = timestampToPersist;

      if (
        this.app.fileManager?.processFrontMatter &&
        this.app.vault.getAbstractFileByPath(file.path) != null
      ) {
        await this.app.fileManager.processFrontMatter(
          file,
          (frontmatter: Record<string, unknown>) => {
            const existingValue = Number(frontmatter.lastAccessedAt);
            const existingAtMs =
              Number.isFinite(existingValue) && existingValue > 0 ? existingValue : 0;

            persistedAtMs = Math.max(existingAtMs, timestampToPersist);

            if (existingAtMs === persistedAtMs) {
              return;
            }

            frontmatter.lastAccessedAt = persistedAtMs;
          }
        );
      } else {
        await patchFrontmatter(this.app, file.path, { lastAccessedAt: persistedAtMs });
      }

      this.chatHistoryLastAccessedAtManager.markPersisted(file.path, persistedAtMs);
    } catch (error) {
      logWarn(`[CopilotPlugin] Failed to update chat lastAccessedAt for ${file.path}`, error);
    }
  }

  getChatHistoryLastAccessedAtManager(): RecentUsageManager<string> {
    return this.chatHistoryLastAccessedAtManager;
  }

  async loadChatHistory(file: TFile) {
    await this.autosaveCurrentChat();

    const existingView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0];
    if (!existingView) {
      await this.activateView();
    }

    await this.chatUIState.loadChatHistory(file);

    void this.touchChatHistoryLastAccessedAt(file);

    const copilotView = (existingView || this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0])
      ?.view as CopilotView;
    if (copilotView) {
      copilotView.updateView();
    }
  }

  async loadChatById(fileId: string): Promise<void> {
    if (isNativeChatId(fileId)) {
      throw new Error("Chat not found.");
    }
    const file = await resolveFileByPath(this.app, fileId);
    if (!file) throw new Error("Chat file not found.");
    await this.loadChatHistory(file);
  }

  async copyChatLink(resolveNotePath: () => Promise<string>): Promise<void> {
    try {
      const path = await resolveNotePath();
      const file = path ? await resolveFileByPath(this.app, path) : null;
      const id = file && (await getSavedChatDeepLinkId(this.app, file.path));
      if (!file || !id) throw new Error(`No saved chat note to link: "${path}"`);
      const url = buildChatDeepLink(this.app.vault.getName(), id);
      await navigator.clipboard.writeText(
        buildChatMarkdownLink(extractChatTitle(this.app, file), url)
      );
      new Notice("Chat link copied.");
    } catch (error) {
      logError("Failed to copy chat link", error);
      new Notice("Could not copy chat link.");
    }
  }

  async openChatDeepLink(params: Record<string, string>): Promise<void> {
    const id = params.id ?? "";
    try {
      const chatId = isNativeChatId(id) ? id : (await findChatFileByDeepLinkId(this.app, id))?.path;
      if (!chatId) {
        new Notice("Chat link not found.");
        return;
      }
      await this.loadChatById(chatId);
    } catch (error) {
      logError("Failed to open chat link", error);
      new Notice("Could not open chat link.");
    }
  }

  async openChatSourceFile(fileId: string): Promise<void> {
    if (isNativeChatId(fileId)) {
      new Notice(
        "This chat has no saved note. Turn on Autosave Chat as Markdown to save chats as notes in your vault."
      );
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
    } else if (await this.app.vault.adapter.exists(fileId)) {
      new Notice(
        "Cannot open source files from hidden directories. To open chat notes in the editor, save them to a non-hidden folder in settings."
      );
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async updateChatTitle(fileId: string, newTitle: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await this.app.fileManager.processFrontMatter(
        file,
        (frontmatter: Record<string, unknown>) => {
          frontmatter.topic = newTitle;
        }
      );

      await new Promise<void>((resolve) => {
        const handler = (updatedFile: TFile) => {
          if (updatedFile.path === fileId) {
            this.app.metadataCache.off("changed", handler);
            window.clearTimeout(timeoutId);
            resolve();
          }
        };

        this.app.metadataCache.on("changed", handler);

        const timeoutId = window.setTimeout(() => {
          this.app.metadataCache.off("changed", handler);
          resolve();
        }, 500);
      });

      new Notice("Chat title updated.");
    } else if (await resolveFileByPath(this.app, fileId)) {
      await patchFrontmatter(this.app, fileId, { topic: newTitle.trim() });
      new Notice("Chat title updated.");
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async deleteChatHistory(fileId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await trashFile(this.app, file);
      new Notice("Chat deleted.");
    } else if (await this.app.vault.adapter.exists(fileId)) {
      await this.app.vault.adapter.remove(fileId);
      new Notice("Chat deleted.");
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async handleNewChat() {
    clearRecordedPromptPayload();
    await logFileManager.clear();

    if (getSettings().enableRecentConversations) {
      try {
        const chainManager = this.chainOwner.getCurrentChainManager();
        const chatModel = chainManager.chatModelManager.getChatModel(false);
        this.userMemoryManager.addRecentConversation(this.chatUIState.getMessages(), chatModel);
      } catch (error) {
        logInfo("Failed to analyze chat messages for memory:", error);
      }
    }

    await this.autosaveCurrentChat();

    const existingView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0];
    if (existingView) {
      const copilotView = existingView.view as CopilotView;
      const abortEvent = new CustomEvent(EVENT_NAMES.ABORT_STREAM, {
        detail: { reason: ABORT_REASON.NEW_CHAT },
      });
      copilotView.eventTarget.dispatchEvent(abortEvent);
    }

    this.chatUIState.clearMessages();

    if (existingView) {
      const copilotView = existingView.view as CopilotView;
      copilotView.updateView();
    } else {
      await this.activateView();
    }
  }

  async newChat() {
    await this.handleNewChat();
  }
}
