import {
  addIndexingError,
  flushIndexedCount,
  getIndexingProgressState,
  resetIndexingProgressState,
  subscribeToIndexingProgress,
  updateIndexingProgressState,
  updateIndexedCountThrottled,
} from "./indexingProgress";

describe("indexingProgress", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetIndexingProgressState();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetIndexingProgressState();
  });

  it("starts in the default idle state", () => {
    expect(getIndexingProgressState()).toEqual({
      isActive: false,
      isPaused: false,
      indexedCount: 0,
      totalFiles: 0,
      errors: [],
      completionStatus: "none",
    });
  });

  it("notifies subscribers on updates", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToIndexingProgress(listener);

    updateIndexingProgressState({ isActive: true, totalFiles: 3 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getIndexingProgressState().isActive).toBe(true);

    unsubscribe();
    updateIndexingProgressState({ isActive: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("appends errors without touching other fields", () => {
    updateIndexingProgressState({ isActive: true, totalFiles: 2 });
    addIndexingError("a.md: boom");

    const state = getIndexingProgressState();
    expect(state.errors).toEqual(["a.md: boom"]);
    expect(state.totalFiles).toBe(2);
    expect(state.isActive).toBe(true);
  });

  it("throttles count updates until the throttle window passes", () => {
    updateIndexingProgressState({ isActive: true, totalFiles: 10 });
    updateIndexedCountThrottled(1);
    updateIndexedCountThrottled(2);

    expect(getIndexingProgressState().indexedCount).toBe(0);

    jest.advanceTimersByTime(500);
    expect(getIndexingProgressState().indexedCount).toBe(2);
  });

  it("flushes the pending count immediately", () => {
    updateIndexedCountThrottled(7);
    flushIndexedCount();
    expect(getIndexingProgressState().indexedCount).toBe(7);
  });

  it("resets to the default state and discards a pending count", () => {
    updateIndexingProgressState({ isActive: true, totalFiles: 5 });
    updateIndexedCountThrottled(4);
    addIndexingError("failure");

    resetIndexingProgressState();

    expect(getIndexingProgressState()).toEqual({
      isActive: false,
      isPaused: false,
      indexedCount: 0,
      totalFiles: 0,
      errors: [],
      completionStatus: "none",
    });
    jest.advanceTimersByTime(1000);
    expect(getIndexingProgressState().indexedCount).toBe(0);
  });
});
