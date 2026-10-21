import type {
    ILanguageFeatureTarget,
    LanguageFeatureRegistry,
} from "../../../../editor/common/languageFeatureRegistry.ts";
import type {
    ICoreRenameLocation,
    ICoreRenameResult,
    IRenameRequest,
    RenameProvider,
} from "../../../../editor/common/languages/iRenameSource.ts";

/**
 * `name: null` means nobody named a name, the caller falls back to the word at the cursor itself;
 * `rejectReason` means the input box doesn't open and the user sees the reason.
 */
export interface IPreparedRename {
    readonly name: string | null;
    readonly rejectReason?: string;
}

/**
 * Responses are not merged: the FIRST provider with something to say decides. A refusal stops
 * the iteration (upstream collects reasons and moves on): the provider applies the edits itself, and
 * the next one would rename what the first one forbade. An RPC failure means "nothing to say".
 */
export async function prepareRename(
    registry: LanguageFeatureRegistry<RenameProvider>,
    target: ILanguageFeatureTarget,
    request: IRenameRequest,
): Promise<IPreparedRename> {
    for (const provider of registry.ordered(target)) {
        const location = await provider.prepareRename(request).catch((): ICoreRenameLocation | null => null);
        if (location === null) continue;
        if (location.kind === "reject") return { name: null, rejectReason: location.reason };
        return { name: location.name };
    }
    return { name: null };
}

/** A provider without edits is skipped, a refusal stops the iteration; no result gives `applied: false` with no message. */
export async function renameSymbol(
    registry: LanguageFeatureRegistry<RenameProvider>,
    target: ILanguageFeatureTarget,
    request: IRenameRequest,
    newName: string,
): Promise<ICoreRenameResult> {
    for (const provider of registry.ordered(target)) {
        const result = await provider
            .provideRenameEdits(request, newName)
            .catch((): ICoreRenameResult => ({ applied: false, error: "Rename failed" }));
        if (result.applied || result.error !== undefined) return result;
    }
    return { applied: false };
}
