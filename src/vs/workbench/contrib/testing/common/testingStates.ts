import { TestResultState } from "../../../api/common/testingWireTypes.ts";

// Upstream `contrib/testing/common/testingStates.ts`.

/** Upstream `statePriority`: a parent shows the state of the highest priority among its own and its children's. */
export const statePriority: Readonly<Record<TestResultState, number>> = {
    [TestResultState.Running]: 6,
    [TestResultState.Errored]: 5,
    [TestResultState.Failed]: 4,
    [TestResultState.Queued]: 3,
    [TestResultState.Passed]: 2,
    [TestResultState.Skipped]: 1,
    [TestResultState.Unset]: 0,
};

export function isFailedState(state: TestResultState): boolean {
    return state === TestResultState.Errored || state === TestResultState.Failed;
}

/** Upstream `isStateWithResult`: the test ran to an outcome. */
export function isStateWithResult(state: TestResultState): boolean {
    return isFailedState(state) || state === TestResultState.Passed;
}

export function maxPriority(...states: TestResultState[]): TestResultState {
    let max: TestResultState = TestResultState.Unset;
    // Stryker disable next-line EqualityOperator: equivalent — every state has its own priority, equal ones are the same state
    for (const state of states) if (statePriority[state] > statePriority[max]) max = state;
    return max;
}

/** Upstream `statesInOrder`: the highest priority first. */
export const statesInOrder: readonly TestResultState[] = (Object.values(TestResultState) as TestResultState[]).sort(
    (a, b) => statePriority[b] - statePriority[a],
);

/**
 * Upstream `terminalStatePriorities`: once a task reported one of these for a test, a lower one or a non-terminal
 * state does not replace it.
 */
export const terminalStatePriorities: Readonly<Partial<Record<TestResultState, number>>> = {
    [TestResultState.Passed]: 0,
    [TestResultState.Skipped]: 1,
    [TestResultState.Failed]: 2,
    [TestResultState.Errored]: 3,
};

export type TestStateCount = Record<TestResultState, number>;

export function makeEmptyCounts(): TestStateCount {
    return Object.fromEntries(Object.values(TestResultState).map((state) => [state, 0])) as TestStateCount;
}

/**
 * Upstream `getComputedState` for one node: its own state raised by its children's. Upstream's special case of an
 * `Unset` node with skipped children (#131537) is the priority order itself here: Skipped outranks Unset.
 */
export function computeState(own: TestResultState, children: Iterable<TestResultState>): TestResultState {
    return maxPriority(own, ...children);
}

/** Upstream `formatDuration` (`testingExplorerView.ts`). */
export function formatDuration(ms: number): string {
    if (ms < 10) return `${ms.toFixed(1)}ms`;
    if (ms < 1_000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}
