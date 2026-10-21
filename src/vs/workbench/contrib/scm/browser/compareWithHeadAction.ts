import { Uri } from "../../../../base/common/uri.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { IOpenDiffPairOptions } from "../../diff/browser/openDiffPair.ts";
import { openDiffPair, showCompareNotice } from "../../diff/browser/openDiffPair.ts";

import { OriginalResourceProviderDIToken } from "./quickDiffService.ts";

export { COMPARE_NOTICE_MS } from "../../diff/browser/openDiffPair.ts";

/** `"no-original"` means nothing to compare with; the caller picks the reaction (notice, open the file). */
export type OpenDiffResult = "opened" | "no-original";

/**
 * The modified side is the uri's open buffer (unsaved edits are visible), otherwise a snapshot
 * from disk; a deleted file (status D) yields a "revision ↔ empty" diff.
 */
export async function openDiffWithHead(accessor: ServiceAccessor, uri: Uri, ref = "HEAD"): Promise<OpenDiffResult> {
    const options = await buildHeadPairOptions(accessor, uri, ref);
    if (options === null) return "no-original";
    const result = await openDiffPair(accessor, options);
    return result === "opened" ? "opened" : "no-original";
}

/**
 * On the right a read failure always means "empty" (status D). On the left: for HEAD a failure
 * means broken git (the extension already filtered out untracked), so refusing is more honest
 * than empty; for an explicit ref "no file" is normal and the whole diff is added.
 */
export async function buildHeadPairOptions(
    accessor: ServiceAccessor,
    uri: Uri,
    ref: string,
): Promise<IOpenDiffPairOptions | null> {
    const originalUri = await resolveOriginalUri(accessor, uri, ref);
    if (originalUri === null) return null;

    const editors = accessor.get(EditorServiceDIToken);
    // The label matches the file's open tab, whatever group it is in.
    const pane = editors.getEditors().find((p) => p.uri.toString() === uri.toString());
    const label = pane ? editors.displayName(pane) : uri.path.slice(uri.path.lastIndexOf("/") + 1);

    return {
        original: {
            uri: originalUri,
            label: ref,
            identity: originalUri.toString(),
            onMissing: ref === "HEAD" ? "error" : "empty",
        },
        modified: { uri, label, identity: uri.toString(), onMissing: "empty" },
        title: `${label} ↔ ${ref}`,
    };
}

async function resolveOriginalUri(accessor: ServiceAccessor, uri: Uri, ref: string): Promise<Uri | null> {
    try {
        const original = await accessor.get(OriginalResourceProviderDIToken).provideOriginalResource(uri, ref);
        // A scheme without a provider is not checked: HEAD will not read, same outcome.
        return original;
    } catch {
        return null;
    }
}

async function compareWithHead(accessor: ServiceAccessor): Promise<void> {
    const editors = accessor.get(EditorServiceDIToken);
    // On the diff tab itself a repeated call must target its source file,
    // not the active side's resource (synthetic for a snapshot).
    const activeTab = editors.getActiveTabPane();
    const uri = activeTab instanceof DiffEditorPane2 ? activeTab.modifiedUri : (editors.getActiveEditor()?.uri ?? null);
    if (uri === null) return;

    const result = await openDiffWithHead(accessor, uri);
    if (result === "no-original") {
        // Untracked, outside the repository, git unavailable: all the same to the user.
        showCompareNotice(accessor, "No changes to compare: the file has no version in git");
    }
}

export const compareWithHeadAction: CommandAction = {
    id: "diode.scm.compareWithHead",
    title: "Git: Compare Active File with HEAD",
    run(accessor) {
        void compareWithHead(accessor);
    },
};
