import { logFileManager } from "@/logFileManager";
import { FileCache } from "@/cache/fileCache";
import { logError } from "@/logger";
import {
  clearRecordedPromptPayload,
  flushRecordedPromptPayloadToLog,
} from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";

import { CustomCommandSettingsModal } from "@/commands/CustomCommandSettingsModal";
import { EMPTY_COMMAND } from "@/commands/constants";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { getCachedCustomCommands } from "@/commands/state";
import { CustomCommand } from "@/commands/type";
import {
  QUICK_COMMAND_SYSTEM_PROMPT,
  appendIncludeNoteContextPlaceholders,
} from "@/commands/quickCommandPrompts";
import { CustomCommandChatModal } from "@/commands/CustomCommandChatModal";
import { ApplyCustomCommandModal } from "@/components/modals/ApplyCustomCommandModal";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import type CopilotPlugin from "@/main";
import { getAllQAMarkdownContent } from "@/search/searchUtils";
import { getEffectiveCopilotFolder } from "@/settings/copilotFolder";
import { NoteSelectedTextContext, WebSelectedTextContext } from "@/types/message";
import { ensureFolderExists, isSourceModeOn } from "@/utils";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { Editor, MarkdownView, Notice, TFile } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { COMMAND_IDS, COMMAND_ICONS, COMMAND_NAMES, CommandId } from "@/constants";
import { setSelectedTextContexts } from "@/aiParams";

function addCommand(plugin: CopilotPlugin, id: CommandId, callback: () => void | Promise<void>) {
  plugin.addCommand({
    id,
    name: COMMAND_NAMES[id],
    icon: COMMAND_ICONS[id],
    callback: () => {
      const result = callback();
      if (result instanceof Promise) {
        result.catch((err) => logError(`Command ${id} failed`, err));
      }
    },
  });
}

function addEditorCommand(
  plugin: CopilotPlugin,
  id: CommandId,
  callback: (editor: Editor) => void | Promise<void>
) {
  plugin.addCommand({
    id,
    name: COMMAND_NAMES[id],
    icon: COMMAND_ICONS[id],
    editorCallback: (editor) => {
      const result = callback(editor);
      if (result instanceof Promise) {
        result.catch((err) => logError(`Editor command ${id} failed`, err));
      }
    },
  });
}

function addCheckCommand(
  plugin: CopilotPlugin,
  id: CommandId,
  callback: (checking: boolean) => boolean | void
) {
  plugin.addCommand({
    id,
    name: COMMAND_NAMES[id],
    icon: COMMAND_ICONS[id],
    checkCallback: callback,
  });
}

export function registerCommands(plugin: CopilotPlugin) {
  addEditorCommand(plugin, COMMAND_IDS.COUNT_WORD_AND_TOKENS_SELECTION, async (editor: Editor) => {
    const selectedText = editor.getSelection();
    const wordCount = selectedText.split(" ").length;
    const tokenCount = await plugin.chainOwner
      .getCurrentChainManager()
      .chatModelManager.countTokens(selectedText);
    new Notice(`Selected text contains ${wordCount} words and ${tokenCount} tokens.`);
  });

  addCommand(plugin, COMMAND_IDS.COUNT_TOTAL_VAULT_TOKENS, async () => {
    try {
      const allContent = await getAllQAMarkdownContent(plugin.app);
      const totalTokens = await plugin.chainOwner
        .getCurrentChainManager()
        .chatModelManager.countTokens(allContent);
      new Notice(`Total tokens in your vault: ${totalTokens}`);
    } catch (error) {
      logError("Error counting tokens: ", error);
      new Notice("An error occurred while counting tokens.");
    }
  });

  addCommand(plugin, COMMAND_IDS.TOGGLE_COPILOT_CHAT_WINDOW, () => {
    plugin.toggleView();
  });

  addCommand(plugin, COMMAND_IDS.OPEN_COPILOT_CHAT_WINDOW, async () => {
    await plugin.activateView();
  });

  addCommand(plugin, COMMAND_IDS.OPEN_RELEVANT_NOTES_VIEW, async () => {
    await plugin.activateRelevantNotesView();
  });

  addCommand(plugin, COMMAND_IDS.NEW_CHAT, async () => {
    clearRecordedPromptPayload();
    await plugin.newChat();
  });

  addCheckCommand(plugin, COMMAND_IDS.TRIGGER_QUICK_COMMAND, (checking: boolean) => {
    const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);

    if (checking) {
      return !!(!isSourceModeOn(plugin.app) && activeView && activeView.editor);
    }

    if (isSourceModeOn(plugin.app)) {
      new Notice("Quick command is not available in source mode.");
      return false;
    }

    if (!activeView || !activeView.editor) {
      new Notice("No active editor found.");
      return false;
    }

    const editor = activeView.editor;
    const selectedText = editor.getSelection();

    if (!selectedText.trim()) {
      new Notice("Please select some text first. Selected text is required for quick commands.");
      return false;
    }

    const quickCommand: CustomCommand = {
      title: "Quick Command",
      content: "",
      showInContextMenu: false,
      showInSlashMenu: false,
      order: 0,
      modelKey: "",
      lastUsedMs: Date.now(),
    };

    const modal = new CustomCommandChatModal(plugin.app, {
      selectedText,
      command: quickCommand,
      systemPrompt: QUICK_COMMAND_SYSTEM_PROMPT,
      behaviorConfig: {
        autoExecuteOnOpen: false,
        hideContentAreaOnIdle: true,
        commandLabel: "Quick Command",
        commandIcon: null,
        showIncludeNoteContext: true,
        firstSubmitTransform: (input, includeNoteContext) =>
          appendIncludeNoteContextPlaceholders(input, includeNoteContext),
      },
    });
    modal.open();

    return true;
  });

  addCommand(plugin, COMMAND_IDS.LOAD_COPILOT_CHAT_CONVERSATION, async () => {
    await plugin.loadCopilotChatHistory();
  });

  addCommand(plugin, COMMAND_IDS.CLEAR_COPILOT_CACHE, async () => {
    try {
      plugin.fileParserManager.clearPDFCache(plugin.app.vault);

      const fileCache = FileCache.getInstance<string>();
      await fileCache.clear(plugin.app.vault);

      if (isDesktopRuntime()) {
        const { cacheRoot } = await import("@/context/conversionsLocation");
        const { createNodeContextCacheFs } = await import("@/context/contextCacheFs");
        await createNodeContextCacheFs(cacheRoot(plugin.app)).clear();
      }

      new Notice("All Copilot caches cleared successfully");
    } catch (error) {
      logError("Error clearing Copilot caches:", error);
      new Notice("Failed to clear Copilot caches");
    }
  });

  addCommand(plugin, COMMAND_IDS.OPEN_LOG_FILE, async () => {
    try {
      await flushRecordedPromptPayloadToLog();
      await logFileManager.openLogFile();
    } catch (error) {
      logError("Error creating Copilot log file:", error);
      new Notice("Failed to create Copilot log file.");
    }
  });

  addCommand(plugin, COMMAND_IDS.CLEAR_LOG_FILE, async () => {
    try {
      await logFileManager.clear();
      new Notice("Copilot log cleared.");
    } catch (error) {
      logError("Error clearing Copilot log file:", error);
      new Notice("Failed to clear Copilot log file.");
    }
  });

  addCommand(plugin, COMMAND_IDS.CLEAR_LOCAL_SEMANTIC_INDEX, async () => {
    const { getSettings } = await import("@/settings/model");
    if (!getSettings().useLocalEmbeddings) {
      new Notice("Local semantic search is disabled in settings.");
      return;
    }
    const confirmed = await new Promise<boolean>((resolve) => {
      new ConfirmModal(
        plugin.app,
        () => resolve(true),
        "This will permanently delete the local semantic index. All stored note vectors will be removed and the index stays empty until notes change again. This action cannot be undone.",
        "Clear Semantic Index",
        "Clear Index",
        "Cancel",
        () => resolve(false)
      ).open();
    });
    if (!confirmed) return;
    try {
      const { clearLocalEmbeddingIndex } =
        await import("@/search/embeddings/localEmbeddingService");
      await clearLocalEmbeddingIndex();
      new Notice("Cleared local semantic index.");
    } catch (error) {
      logError("Error clearing local semantic index:", error);
      new Notice("Failed to clear local semantic index.");
    }
  });

  addCommand(plugin, COMMAND_IDS.REFRESH_LOCAL_SEMANTIC_INDEX, async () => {
    const { getSettings } = await import("@/settings/model");
    if (!getSettings().useLocalEmbeddings) {
      new Notice("Local semantic search is disabled in settings.");
      return;
    }
    try {
      const { refreshLocalEmbeddingIndex } =
        await import("@/search/embeddings/localEmbeddingService");
      const count = await refreshLocalEmbeddingIndex();
      new Notice(`Local semantic index refreshed (${count} notes indexed).`);
    } catch (error) {
      logError("Error refreshing local semantic index:", error);
      new Notice("Failed to refresh local semantic index.");
    }
  });

  addCommand(plugin, COMMAND_IDS.REINDEX_LOCAL_SEMANTIC_INDEX, async () => {
    const { getSettings } = await import("@/settings/model");
    if (!getSettings().useLocalEmbeddings) {
      new Notice("Local semantic search is disabled in settings.");
      return;
    }
    const confirmed = await new Promise<boolean>((resolve) => {
      new ConfirmModal(
        plugin.app,
        () => resolve(true),
        "This will delete and rebuild your entire local semantic index from scratch. Every note will be embedded again. Are you sure you want to proceed?",
        "Force Reindex Vault",
        "Continue",
        "Cancel",
        () => resolve(false)
      ).open();
    });
    if (!confirmed) return;
    try {
      const { reindexLocalEmbeddingIndex } =
        await import("@/search/embeddings/localEmbeddingService");
      const count = await reindexLocalEmbeddingIndex();
      new Notice(`Local semantic index rebuilt (${count} notes indexed).`);
    } catch (error) {
      logError("Error rebuilding local semantic index:", error);
      new Notice("Failed to rebuild local semantic index.");
    }
  });

  addCommand(plugin, COMMAND_IDS.LIST_SEMANTIC_INDEXED_FILES, async () => {
    try {
      const { listIndexedNotes } = await import("@/search/embeddings/localEmbeddingService");
      const indexedPaths = listIndexedNotes();
      if (indexedPaths === null) {
        new Notice("No local semantic index available. Enable semantic search in settings.");
        return;
      }
      const { getMatchingPatterns, shouldIndexFile } = await import("@/search/searchUtils");
      const { inclusions, exclusions } = getMatchingPatterns();
      const allMarkdownFiles = plugin.app.vault.getMarkdownFiles();
      const emptyFiles = new Set<string>();
      const unindexedFiles = new Set<string>();
      const excludedFiles = new Set<string>();
      const indexedFiles = new Set<string>(indexedPaths);

      for (const file of allMarkdownFiles) {
        if (!shouldIndexFile(plugin.app, file, inclusions, exclusions)) {
          excludedFiles.add(file.path);
          continue;
        }
        const content = await plugin.app.vault.cachedRead(file);
        if (!content || content.trim().length === 0) {
          emptyFiles.add(file.path);
        } else if (!indexedFiles.has(file.path)) {
          unindexedFiles.add(file.path);
        }
      }

      const report = [
        "# Copilot Files Status",
        `- Indexed files: ${indexedFiles.size}`,
        `- Unindexed files: ${unindexedFiles.size}`,
        `- Empty files: ${emptyFiles.size}`,
        `- Excluded files: ${excludedFiles.size}`,
        "",
        "## Indexed Files",
        ...(indexedFiles.size > 0
          ? Array.from(indexedFiles)
              .sort()
              .map((path) => `- [[${path}]]`)
          : ["No indexed files found."]),
        "",
        "## Unindexed Files",
        ...(unindexedFiles.size > 0
          ? Array.from(unindexedFiles)
              .sort()
              .map((path) => `- [[${path}]]`)
          : ["No unindexed files found."]),
        "",
        "## Empty Files",
        ...(emptyFiles.size > 0
          ? Array.from(emptyFiles)
              .sort()
              .map((path) => `- [[${path}]]`)
          : ["No empty files found."]),
        "",
        "## Excluded Files (based on settings)",
        ...(excludedFiles.size > 0
          ? Array.from(excludedFiles)
              .sort()
              .map((path) => `- [[${path}]]`)
          : ["No excluded files."]),
      ].join("\n");

      const fileName = `Copilot-Indexed-Files-${new Date().toLocaleDateString().replace(/\//g, "-")}.md`;
      const folderPath = getEffectiveCopilotFolder();
      const filePath = `${folderPath}/${fileName}`;
      await ensureFolderExists(plugin.app.vault, folderPath);
      const existingFile = plugin.app.vault.getAbstractFileByPath(filePath);
      if (existingFile instanceof TFile) {
        await plugin.app.vault.modify(existingFile, report);
      } else {
        await plugin.app.vault.create(filePath, report);
      }
      const createdFile = plugin.app.vault.getAbstractFileByPath(filePath);
      if (createdFile instanceof TFile) {
        await plugin.app.workspace.getLeaf().openFile(createdFile);
        new Notice(`Listed ${indexedFiles.size} indexed files`);
      }
    } catch (error) {
      logError("Error listing indexed files:", error);
      new Notice("Failed to list indexed files.");
    }
  });

  addEditorCommand(plugin, COMMAND_IDS.ADD_SELECTION_TO_CHAT_CONTEXT, async (editor: Editor) => {
    const selectedText = editor.getSelection();
    if (!selectedText) {
      new Notice("No text selected");
      return;
    }

    const activeFile = plugin.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active file");
      return;
    }

    const selectionRange = editor.listSelections()[0];
    if (!selectionRange) {
      new Notice("Could not determine selection range");
      return;
    }

    const startLine = selectionRange.anchor.line + 1;
    const endLine = selectionRange.head.line + 1;

    const selectedTextContext: NoteSelectedTextContext = {
      id: uuidv4(),
      content: selectedText,
      sourceType: "note",
      noteTitle: activeFile.basename,
      notePath: activeFile.path,
      startLine: Math.min(startLine, endLine),
      endLine: Math.max(startLine, endLine),
    };

    setSelectedTextContexts([selectedTextContext]);

    await plugin.activateChatViewForContext();
  });

  addCommand(plugin, COMMAND_IDS.ADD_WEB_SELECTION_TO_CHAT_CONTEXT, async () => {
    if (!isDesktopRuntime()) {
      new Notice("Web selection is only available on desktop");
      return;
    }

    const { getWebViewerService } =
      await import("@/services/webViewerService/webViewerServiceSingleton");

    try {
      const service = getWebViewerService(plugin.app);
      const leaf = service.getActiveLeaf() ?? service.getLastActiveLeaf();

      if (!leaf) {
        new Notice("No active Web Tab found");
        return;
      }

      const selectedMarkdown = await service.getSelectedMarkdown(leaf);
      if (!selectedMarkdown.trim()) {
        new Notice("No text selected in Web Tab");
        return;
      }

      const pageInfo = service.getPageInfo(leaf);

      const webSelectedTextContext: WebSelectedTextContext = {
        id: uuidv4(),
        content: selectedMarkdown,
        sourceType: "web",
        title: pageInfo.title || "Untitled",
        url: pageInfo.url,
        faviconUrl: pageInfo.faviconUrl || undefined,
      };

      setSelectedTextContexts([webSelectedTextContext]);

      await plugin.activateChatViewForContext();
    } catch (error) {
      logError("Error adding web selection to context:", error);
      new Notice("Failed to get web selection");
    }
  });

  addCommand(plugin, COMMAND_IDS.ADD_CUSTOM_COMMAND, async () => {
    const commands = getCachedCustomCommands();
    const newCommand = { ...EMPTY_COMMAND };
    const modal = new CustomCommandSettingsModal(
      plugin.app,
      commands,
      newCommand,
      async (updatedCommand) => {
        await CustomCommandManager.getInstance().createCommand(updatedCommand);
      }
    );
    modal.open();
  });

  addCommand(plugin, COMMAND_IDS.APPLY_CUSTOM_COMMAND, () => {
    const modal = new ApplyCustomCommandModal(plugin.app);
    modal.open();
  });

  addCheckCommand(plugin, COMMAND_IDS.TRIGGER_QUICK_ASK, (checking: boolean) => {
    const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);

    if (checking) {
      return !!(!isSourceModeOn(plugin.app) && activeView && activeView.editor);
    }

    if (isSourceModeOn(plugin.app)) {
      new Notice("Quick Ask is not available in source mode.");
      return false;
    }

    if (!activeView || !activeView.editor) {
      new Notice("No active editor found.");
      return false;
    }

    const view = activeView.editor.cm;
    if (!view) {
      new Notice("Could not access CodeMirror editor.");
      return false;
    }

    plugin.quickAskController.show(activeView, view);
    return true;
  });
}
