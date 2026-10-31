import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { DiffEditorPane2 } from "../../browser/parts/editor/diffEditorPane2.ts";
import type { IBulkEditService } from "../../contrib/bulkEdit/common/iBulkEditService.ts";
import type { IEditorGroupsService } from "../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";
import type { IActiveEditorMeta } from "../common/iEditorOptionsService.ts";

import { EditorOptionsServiceAdapter } from "./editorOptionsServiceAdapter.ts";

const NO_BULK_EDITS: IBulkEditService = { applyWorkspaceEdit: () => Promise.resolve(false) };

function fakeSide(path: string) {
    return {
        uri: Uri.file(path),
        languageId: "plaintext",
        isModified: false,
        encoding: "utf8",
        eol: 1,
        viewState: { selections: [] },
    };
}

/** Only `instanceof` and the two side accessors matter here; a real diff pane needs the whole editor stack. */
function fakeDiff(snapshotSides: string[]): DiffEditorPane2 {
    return Object.assign(Object.create(DiffEditorPane2.prototype) as object, {
        snapshotSides: () => snapshotSides,
        sidePanes: () => [fakeSide("/left.txt"), fakeSide("/right.txt")],
    }) as unknown as DiffEditorPane2;
}

function setup(activePane: unknown) {
    let fire: (editor: null) => void = () => undefined;
    const editors = {
        getActiveTabEditor: () => null,
        onActiveEditorChanged: (listener: (editor: null) => void) => {
            fire = listener;
            return { dispose: () => undefined };
        },
    } as unknown as IEditorService;
    const activeGroup = { id: 7, activePane };
    const groups = {
        activeGroup,
        groupOf: () => activeGroup,
        viewColumnOf: () => 1,
    } as unknown as IEditorGroupsService;
    const adapter = new EditorOptionsServiceAdapter(editors, groups, NO_BULK_EDITS);
    const seen: IActiveEditorMeta[] = [];
    adapter.onActiveEditorChanged((meta) => seen.push(meta));
    return {
        adapter,
        seen,
        fire: () => {
            fire(null);
        },
    };
}

describe("EditorOptionsServiceAdapter: an active diff", () => {
    it("[api:window.activeTextEditor] the active editor is the modified side, in the meta and in the event", () => {
        const { adapter, seen, fire } = setup(fakeDiff([]));

        expect(adapter.getActiveEditorMeta().uri).toBe(Uri.file("/right.txt").toString());
        fire();
        expect(seen[0].uri).toBe(Uri.file("/right.txt").toString());
        expect(seen[0].groupId).toBe(7);
    });

    it("a snapshot modified side has no document: no active editor", () => {
        const { adapter, seen, fire } = setup(fakeDiff(["modified"]));

        expect(adapter.getActiveEditorMeta().uri).toBeNull();
        fire();
        expect(seen[0].uri).toBeNull();
    });

    it("a tab that is not a diff is left to the service", () => {
        const { adapter } = setup({ uri: Uri.file("/other.txt") });

        expect(adapter.getActiveEditorMeta().uri).toBeNull();
    });
});
