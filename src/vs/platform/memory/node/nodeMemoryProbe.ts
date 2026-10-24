import type { IMemoryProbe } from "../common/iMemoryProbe.ts";

/**
 * `process.availableMemory()` (libuv `uv_get_available_memory`): `MemAvailable` of the machine, or what is left
 * under the cgroup limit in a container. Not the V8 heap: the text of a file read in chunks of megabytes lives in
 * external strings outside the heap, so the machine's memory is what runs out.
 */
export const nodeMemoryProbe: IMemoryProbe = {
    availableBytes: () => process.availableMemory(),
};
