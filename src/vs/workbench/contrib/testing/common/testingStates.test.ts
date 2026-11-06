import { describe, expect, it } from "vitest";

import { TestResultState } from "../../../api/common/testingWireTypes.ts";

import {
    computeState,
    formatDuration,
    isFailedState,
    isStateWithResult,
    makeEmptyCounts,
    maxPriority,
    statesInOrder,
} from "./testingStates.ts";

const { Unset, Queued, Running, Passed, Failed, Skipped, Errored } = TestResultState;

describe("testingStates (upstream testingStates.ts)", () => {
    it("the priority order: Running, Errored, Failed, Queued, Passed, Skipped, Unset", () => {
        expect(statesInOrder).toEqual([Running, Errored, Failed, Queued, Passed, Skipped, Unset]);
        expect(maxPriority()).toBe(Unset);
        expect(maxPriority(Passed, Queued, Skipped)).toBe(Queued);
        expect(maxPriority(Failed, Errored)).toBe(Errored);
    });

    it("failed and errored are failures; with them passed has a result", () => {
        expect(statesInOrder.filter(isFailedState)).toEqual([Errored, Failed]);
        expect(statesInOrder.filter(isStateWithResult)).toEqual([Errored, Failed, Passed]);
    });

    it("a parent takes the highest child state; all skipped children make an unset parent skipped", () => {
        expect(computeState(Unset, [])).toBe(Unset);
        expect(computeState(Unset, [Passed, Failed])).toBe(Failed);
        expect(computeState(Unset, [Skipped, Skipped])).toBe(Skipped);
        expect(computeState(Passed, [Skipped])).toBe(Passed);
        expect(computeState(Unset, [Skipped, Passed])).toBe(Passed);
    });

    it("empty counts have every state at zero", () => {
        expect(Object.values(makeEmptyCounts())).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });

    it("durations as upstream's formatDuration", () => {
        expect(formatDuration(3)).toBe("3.0ms");
        expect(formatDuration(9.94)).toBe("9.9ms");
        expect(formatDuration(10)).toBe("10ms");
        expect(formatDuration(999)).toBe("999ms");
        expect(formatDuration(1000)).toBe("1.0s");
        expect(formatDuration(3450)).toBe("3.5s");
    });
});
