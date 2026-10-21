import { describe, expect, it } from "vitest";

import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";

import { MACHINE_ID_STATE, resolveMachineId } from "./machineIdState.ts";

function memoryState(seed: Record<string, unknown> = {}): IStateService & { readonly data: Record<string, unknown> } {
    const data = { ...seed };
    return {
        ...NULL_STATE_SERVICE,
        data,
        get: <T>(descriptor: IStateDescriptor<T>): T =>
            descriptor.key in data ? (data[descriptor.key] as T) : descriptor.default,
        store: <T>(descriptor: IStateDescriptor<T>, value: T): void => {
            data[descriptor.key] = value;
        },
    };
}

describe("resolveMachineId", () => {
    it("key and scope match upstream: `telemetry.machineId` in application state", () => {
        expect(MACHINE_ID_STATE).toEqual({ key: "telemetry.machineId", scope: "application", default: "" });
    });

    it("a stored id is returned as is, without recomputing", () => {
        const state = memoryState({ "telemetry.machineId": "cached" });
        expect(resolveMachineId(state, () => "fresh")).toBe("cached");
    });

    it("first run: the id is computed and stored, and a second call sees the same one", () => {
        const state = memoryState();
        let calls = 0;
        const compute = (): string => `id-${String(++calls)}`;
        expect(resolveMachineId(state, compute)).toBe("id-1");
        expect(state.data["telemetry.machineId"]).toBe("id-1");
        expect(resolveMachineId(state, compute)).toBe("id-1");
        expect(calls).toBe(1);
    });

    it("computes the real machine id by default", () => {
        expect(resolveMachineId(memoryState())).toMatch(/^([0-9a-f]{64}|[0-9a-f-]{36})$/);
    });
});
