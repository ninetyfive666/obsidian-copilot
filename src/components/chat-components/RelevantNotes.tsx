import { RelevantNoteRow } from "@/components/chat-components/ui/RelevantNoteRow";
import { RelevantNotesPane } from "@/components/chat-components/ui/RelevantNotesPane";
import { RelevantNotesToolbar } from "@/components/chat-components/ui/RelevantNotesToolbar";
import { useRelevantNoteRowTransitions } from "@/components/chat-components/ui/useRelevantNoteRowTransitions";
import { useApp } from "@/context";
import { useActiveFile } from "@/hooks/useActiveFile";
import { useLiveRelevantNotesRefresh } from "@/hooks/useLiveRelevantNotesRefresh";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import {
  findRelevantNotes,
  isSameRelevantNotesResult,
  type RelevantNoteEntry,
} from "@/search/findRelevantNotes";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { TFile } from "obsidian";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";

const EMPTY_RELEVANT_NOTES: readonly RelevantNoteEntry[] = Object.freeze([]);
const IDLE_RELEVANT_NOTES_RESULT = Object.freeze({
  notes: EMPTY_RELEVANT_NOTES,
  status: "idle" as const,
  details: undefined,
});
const LOADING_RELEVANT_NOTES_RESULT = Object.freeze({
  notes: EMPTY_RELEVANT_NOTES,
  status: "loading" as const,
  details: undefined,
});

type RelevantNotesViewResult =
  | typeof IDLE_RELEVANT_NOTES_RESULT
  | typeof LOADING_RELEVANT_NOTES_RESULT
  | Awaited<ReturnType<typeof findRelevantNotes>>;

interface SettledRelevantNotesRequest {
  requestKey: string;
  result: Awaited<ReturnType<typeof findRelevantNotes>>;
}

function nextSettledRequest(
  settled: SettledRelevantNotesRequest | null,
  requestKey: string,
  result: SettledRelevantNotesRequest["result"]
): SettledRelevantNotesRequest {
  return settled?.requestKey === requestKey && isSameRelevantNotesResult(settled.result, result)
    ? settled
    : { requestKey, result };
}

// A live re-query keeps `restart` so rows stay on screen instead of blanking on each keystroke pause.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/362
interface RelevantNotesRequery {
  restart: number;
  live: boolean;
}

const INITIAL_REQUERY: RelevantNotesRequery = Object.freeze({ restart: 0, live: false });

function useRelevantNotes(paused: boolean, liveUpdateEnabled: boolean) {
  const app = useApp();
  const [settledRequest, setSettledRequest] = useState<SettledRelevantNotesRequest | null>(null);
  const [requery, setRequery] = useState<RelevantNotesRequery>(INITIAL_REQUERY);
  const activeFile = useActiveFile();
  // The effect below closes over its starting value, so a ref lets switching live update off freeze an open re-query.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
  const liveUpdateEnabledRef = useRef(liveUpdateEnabled);
  liveUpdateEnabledRef.current = liveUpdateEnabled;
  const searchOpenRef = useRef(false);
  const activeFilePath = !paused && activeFile?.extension === "md" ? activeFile.path : undefined;
  const refresh = useCallback(
    () => setRequery((current) => ({ restart: current.restart + 1, live: false })),
    []
  );
  const liveRefresh = useCallback(() => {
    // A slow search would leave two queries in flight and discard one, so skip the tick.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
    if (searchOpenRef.current) return;
    setRequery((current) => ({ ...current, live: true }));
  }, []);
  const requestStatus = !activeFilePath ? "idle" : "ready";
  const requestKey =
    requestStatus === "ready" ? JSON.stringify([activeFilePath, requery.restart]) : null;

  useEffect(() => {
    let cancelled = false;

    async function fetchNotes() {
      if (requestStatus !== "ready" || requestKey === null || !activeFilePath) {
        setSettledRequest(null);
        return;
      }

      // A recurring key clears its stale result, except one settled by a live re-query, which would blank the pane while typing.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
      setSettledRequest((settled) => (settled?.requestKey === requestKey ? settled : null));
      // A live re-query still open when live update is switched off must not re-rank the frozen list.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
      const frozen = (settled: SettledRelevantNotesRequest | null) =>
        requery.live && !liveUpdateEnabledRef.current && settled?.requestKey === requestKey;
      searchOpenRef.current = true;
      try {
        const result = await findRelevantNotes({ app, filePath: activeFilePath });
        if (!cancelled)
          setSettledRequest((settled) =>
            frozen(settled) ? settled : nextSettledRequest(settled, requestKey, result)
          );
      } catch (error) {
        if (!cancelled) {
          logError("Failed to fetch relevant notes", error);
          setSettledRequest(null);
        }
      } finally {
        searchOpenRef.current = false;
      }
    }

    void fetchNotes();
    return () => {
      cancelled = true;
    };
  }, [app, activeFilePath, requestKey, requestStatus, requery]);

  const result: RelevantNotesViewResult =
    requestStatus === "idle"
      ? IDLE_RELEVANT_NOTES_RESULT
      : settledRequest?.requestKey === requestKey
        ? settledRequest.result
        : LOADING_RELEVANT_NOTES_RESULT;

  return { result, refresh, liveRefresh };
}

interface RelevantNotesProps {
  className?: string;
  onAddToChat: (note: TFile) => void;
}

export const RelevantNotes = memo(
  ({ className, onAddToChat }: RelevantNotesProps): React.ReactElement => {
    const app = useApp();
    const activeFile = useActiveFile();
    const settings = useSettingsValue();
    const liveUpdateEnabled = settings.relevantNotesLiveUpdate;
    const { result, liveRefresh } = useRelevantNotes(false, liveUpdateEnabled);
    const activeFileName = activeFile?.extension === "md" ? activeFile.basename : undefined;
    const activeFilePath = activeFile?.extension === "md" ? activeFile.path : undefined;
    const animated = !useReducedMotion();
    const { rows, registerRow } = useRelevantNoteRowTransitions(
      result.notes,
      activeFilePath,
      animated
    );

    useLiveRelevantNotesRefresh({
      app,
      enabled: liveUpdateEnabled,
      filePath: activeFilePath,
      onRefresh: liveRefresh,
    });

    const navigateToNote = (notePath: string) => {
      const file = app.vault.getAbstractFileByPath(notePath);
      if (file instanceof TFile) {
        const leaf = app.workspace.getLeaf(true);
        void leaf.openFile(file).catch((err) => logError("openFile failed", err));
      }
    };
    const addToChat = (notePath: string) => {
      const file = app.vault.getAbstractFileByPath(notePath);
      if (file instanceof TFile) onAddToChat(file);
    };

    return (
      <div
        data-relevant-notes
        className={cn("tw-flex tw-min-h-full tw-w-full tw-flex-1 tw-flex-col", className)}
      >
        <RelevantNotesToolbar
          activeFileName={activeFileName}
          liveUpdate={{
            enabled: settings.relevantNotesLiveUpdate,
            onChange: (enabled) => updateSetting("relevantNotesLiveUpdate", enabled),
          }}
        />
        <div className="tw-relative tw-min-h-0 tw-flex-1">
          <div className="tw-absolute tw-inset-0 tw-overflow-y-auto tw-p-2">
            <RelevantNotesPane
              status={result.status}
              noteRows={rows.map((row) => (
                <RelevantNoteRow
                  key={row.note.note.path}
                  note={row.note}
                  exiting={row.exiting}
                  entering={row.entering}
                  animated={animated}
                  rowRef={registerRow(row.note.note.path)}
                  onAddToChat={() => addToChat(row.note.note.path)}
                  onNavigateToNote={() => navigateToNote(row.note.note.path)}
                />
              ))}
            />
          </div>
        </div>
      </div>
    );
  }
);

RelevantNotes.displayName = "RelevantNotes";
