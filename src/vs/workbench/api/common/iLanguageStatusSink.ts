import type { IWireLanguageStatusItem } from "./wireTypes.ts";

/** Upstream `MainThreadLanguages.$setLanguageStatus`/`$removeLanguageStatus`; `clear`: the subprocess died. */
export interface ILanguageStatusSink {
    /** Full state: replaces the item with the same `handle`. */
    update(item: IWireLanguageStatusItem): void;
    remove(handle: number): void;
    clear(): void;
}
