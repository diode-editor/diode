import { token } from "../../instantiation/common/diContainer.ts";

/**
 * How much memory the process may still take. Asked before a large file is read into memory ("Enable Editing" on
 * the document on disk, docs/arch/Editor.md) and while it streams in: a load that would not fit is refused with a
 * toast instead of ending in an OOM kill. The node implementation is in `platform/memory/node`.
 */
export interface IMemoryProbe {
    /** Bytes the process can still allocate: the free memory of the machine or of its cgroup, whichever is less. */
    availableBytes(): number;
}

export const IMemoryProbeDIToken = token<IMemoryProbe>("IMemoryProbe");
