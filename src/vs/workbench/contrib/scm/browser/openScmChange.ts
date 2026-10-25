import type { Uri } from "../../../../base/common/uri.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { IOpenDiffPairOptions } from "../../diff/browser/openDiffPair.ts";
import { compareLabelOf, openDiffPair } from "../../diff/browser/openDiffPair.ts";

import type { IScmChange } from "./changesService.ts";
import { OriginalResourceProviderDIToken } from "./quickDiffService.ts";

/** The index as an `originalResource` ref, upstream's `~`; duplicated in `extensions/git/lib/gitUri.ts`. */
export const INDEX_REF = "~";

type ChangeSides = Pick<IScmChange, "uri" | "status" | "group">;

/**
 * Upstream `getLeftResource`/`getRightResource`/`getTitle` (`extensions/git/src/repository.ts`): a
 * Changes entry diffs the index with the working tree, a Staged entry diffs HEAD with the index.
 * Untracked and conflicted files open as themselves (no merge editor). `null`: open the file.
 */
export async function buildChangePairOptions(
    accessor: ServiceAccessor,
    change: ChangeSides,
): Promise<IOpenDiffPairOptions | null> {
    if (change.group !== "worktree" && change.group !== "index") return null;
    const name = compareLabelOf(change.uri);
    const deleted = change.status === "D";
    const index = await resolveOriginal(accessor, change.uri, INDEX_REF);
    if (index === null) return null;

    if (change.group === "worktree") {
        return {
            original: { uri: index, label: "Index", identity: index.toString() },
            modified: { uri: change.uri, label: name, identity: change.uri.toString(), onMissing: "empty" },
            title: deleted ? `${name} (Deleted)` : `${name} (Working Tree)`,
        };
    }

    // The provider resolves a staged rename to HEAD by its old path.
    const head = await resolveOriginal(accessor, change.uri, "HEAD");
    if (head === null) return null;
    return {
        original: {
            uri: head,
            label: "HEAD",
            identity: head.toString(),
            onMissing: change.status === "A" ? "empty" : "error",
        },
        // A git uri side is a read-only snapshot: the index is not edited in the editor.
        modified: { uri: index, label: "Index", identity: index.toString(), onMissing: "empty" },
        title: deleted ? `${name} (Deleted)` : `${name} (Index)`,
    };
}

/** Nothing to compare with, or a side is unreadable: the file itself opens, as for untracked. */
export async function openScmChange(accessor: ServiceAccessor, change: ChangeSides): Promise<void> {
    const options = await buildChangePairOptions(accessor, change);
    if (options !== null && (await openDiffPair(accessor, options)) === "opened") return;
    await accessor.get(EditorServiceDIToken).openUri(change.uri);
}

async function resolveOriginal(accessor: ServiceAccessor, uri: Uri, ref: string): Promise<Uri | null> {
    try {
        return await accessor.get(OriginalResourceProviderDIToken).provideOriginalResource(uri, ref);
    } catch {
        return null;
    }
}
