import { Uri } from "../../../../base/common/uri.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import type { IEditorPaneFactory } from "../../../services/editor/browser/editorPaneFactory.ts";

import { diffPaneRecipe, type IDiffSideSpec, type IOpenDiffPairOptions, openDiffPair } from "./openDiffPair.ts";

/** upstream `DiffEditorInput.ID`. */
export const DIFF_EDITOR_PANE_TYPE_ID = "workbench.editors.diffEditorInput";

/** Only a side read from disk by uri goes into the session. */
interface ISerializedDiffSide {
    readonly uri: string;
    readonly label: string;
    readonly identity: string;
    readonly preferDisk?: boolean;
    readonly onMissing?: "empty" | "error";
}

interface ISerializedDiff {
    readonly original: ISerializedDiffSide;
    readonly modified: ISerializedDiffSide;
    readonly title?: string;
}

/**
 * Only diffs of files on disk survive a restart, like upstream `DiffEditorInputSerializer`: a clipboard
 * snapshot is not saved, and the `git:` provider is not activated yet at startup.
 */
export function createDiffEditorPaneFactory(accessor: ServiceAccessor): IEditorPaneFactory<IOpenDiffPairOptions> {
    return {
        typeId: DIFF_EDITOR_PANE_TYPE_ID,
        describe: (pane) => (pane instanceof DiffEditorPane2 ? diffPaneRecipe(pane) : undefined),
        serialize(options) {
            const original = serializeSide(options.original);
            const modified = serializeSide(options.modified);
            if (original === undefined || modified === undefined) return undefined;
            // JSON.stringify drops an unset optional field on its own.
            const value: ISerializedDiff = { original, modified, title: options.title };
            return JSON.stringify(value);
        },
        deserialize(value) {
            const parsed = parseDiff(value);
            if (parsed === undefined) return undefined;
            return {
                original: deserializeSide(parsed.original),
                modified: deserializeSide(parsed.modified),
                title: parsed.title,
            };
        },
        async open(options, target) {
            await openDiffPair(accessor, options, target);
        },
    };
}

function serializeSide(side: IDiffSideSpec): ISerializedDiffSide | undefined {
    if (side.uri?.scheme !== "file" || side.text !== undefined || side.ownedModel !== undefined) return undefined;
    return {
        uri: side.uri.toString(),
        label: side.label,
        identity: side.identity,
        preferDisk: side.preferDisk,
        onMissing: side.onMissing,
    };
}

function deserializeSide(side: ISerializedDiffSide): IDiffSideSpec {
    return {
        uri: Uri.parse(side.uri),
        label: side.label,
        identity: side.identity,
        preferDisk: side.preferDisk,
        onMissing: side.onMissing,
    };
}

/** Session string → recipe; a foreign or broken string yields `undefined`, not an exception. */
function parseDiff(value: string): ISerializedDiff | undefined {
    // The broken-string and non-object guards are equivalent to their mutants: further on
    // parseSide rejects anything that is not a side object anyway (`42` and a string
    // have no `original`). Kept for clarity, not for the result.
    let raw: unknown;
    // Stryker disable BlockStatement,ConditionalExpression: equivalent, see above
    try {
        raw = JSON.parse(value);
    } catch {
        return undefined;
    }
    if (typeof raw !== "object" || raw === null) return undefined;
    // Stryker restore BlockStatement,ConditionalExpression
    const obj = raw as Record<string, unknown>;
    const original = parseSide(obj.original);
    const modified = parseSide(obj.modified);
    if (original === undefined || modified === undefined) return undefined;
    return { original, modified, ...(typeof obj.title === "string" ? { title: obj.title } : {}) };
}

function parseSide(raw: unknown): ISerializedDiffSide | undefined {
    if (typeof raw !== "object" || raw === null) return undefined;
    const side = raw as Record<string, unknown>;
    if (typeof side.uri !== "string" || typeof side.label !== "string" || typeof side.identity !== "string") {
        return undefined;
    }
    return {
        uri: side.uri,
        label: side.label,
        identity: side.identity,
        ...(typeof side.preferDisk === "boolean" ? { preferDisk: side.preferDisk } : {}),
        ...(side.onMissing === "empty" || side.onMissing === "error" ? { onMissing: side.onMissing } : {}),
    };
}
