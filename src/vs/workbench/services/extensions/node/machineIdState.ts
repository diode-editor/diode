import { getMachineId } from "../../../../base/node/id.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";

/** Ключ `telemetry.machineId` в `storage.json`, как у эталона. Пустая строка — «ещё не считали». */
export const MACHINE_ID_STATE: IStateDescriptor<string> = {
    key: "telemetry.machineId",
    scope: "application",
    default: "",
};

/** Без кэша uuid-фоллбэк (машина без MAC-адреса) менялся бы на каждый запуск. */
export function resolveMachineId(state: IStateService, compute: () => string = getMachineId): string {
    const cached = state.get(MACHINE_ID_STATE);
    if (cached !== "") return cached;
    const machineId = compute();
    state.store(MACHINE_ID_STATE, machineId);
    return machineId;
}
