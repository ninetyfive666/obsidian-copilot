import { useSyncExternalStore } from "react";

export type IndexingCompletionStatus = "none" | "success" | "cancelled" | "error";

export interface IndexingProgressState {
  isActive: boolean;
  isPaused: boolean;
  indexedCount: number;
  totalFiles: number;
  errors: string[];
  completionStatus: IndexingCompletionStatus;
}

const DEFAULT_STATE: IndexingProgressState = {
  isActive: false,
  isPaused: false,
  indexedCount: 0,
  totalFiles: 0,
  errors: [],
  completionStatus: "none",
};

const COUNT_THROTTLE_MS = 500;

let state: IndexingProgressState = DEFAULT_STATE;
let pendingCount: number | null = null;
let countTimer: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of Array.from(listeners)) {
    listener();
  }
}

export function getIndexingProgressState(): Readonly<IndexingProgressState> {
  return state;
}

export function setIndexingProgressState(next: IndexingProgressState): void {
  state = next;
  emit();
}

export function updateIndexingProgressState(partial: Partial<IndexingProgressState>): void {
  setIndexingProgressState({ ...state, ...partial });
}

export function addIndexingError(message: string): void {
  updateIndexingProgressState({ errors: [...state.errors, message] });
}

export function resetIndexingProgressState(): void {
  flushIndexedCount();
  setIndexingProgressState({ ...DEFAULT_STATE });
}

export function updateIndexedCountThrottled(count: number): void {
  pendingCount = count;
  if (countTimer !== null) return;
  countTimer = window.setTimeout(() => {
    countTimer = null;
    if (pendingCount !== null) {
      updateIndexingProgressState({ indexedCount: pendingCount });
      pendingCount = null;
    }
  }, COUNT_THROTTLE_MS);
}

export function flushIndexedCount(): void {
  if (countTimer !== null) {
    window.clearTimeout(countTimer);
    countTimer = null;
  }
  if (pendingCount !== null) {
    updateIndexingProgressState({ indexedCount: pendingCount });
    pendingCount = null;
  }
}

export function subscribeToIndexingProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useIndexingProgress(): Readonly<IndexingProgressState> {
  return useSyncExternalStore(subscribeToIndexingProgress, getIndexingProgressState);
}
