import { getMachineId } from "../../../../base/node/id.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";

/** The `telemetry.machineId` key in `storage.json`, as upstream. Empty string means "not computed yet". */
export const MACHINE_ID_STATE: IStateDescriptor<string> = {
    key: "telemetry.machineId",
    scope: "application",
    default: "",
};

/** Without the cache the uuid fallback (machine without a MAC address) would change on every launch. */
export function resolveMachineId(state: IStateService, compute: () => string = getMachineId): string {
    const cached = state.get(MACHINE_ID_STATE);
    if (cached !== "") return cached;
    const machineId = compute();
    state.store(MACHINE_ID_STATE, machineId);
    return machineId;
}
