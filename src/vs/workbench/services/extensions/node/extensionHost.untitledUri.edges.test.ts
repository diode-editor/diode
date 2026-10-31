import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";

const FIXTURE = extensionFixture("test.untitledUriEdges", "untitledUriEdges.cjs");

const execute = <T>(harness: IExtensionHarness, id: string, ...args: unknown[]): Promise<T> =>
    harness.commandRegistry.execute(`test.untitledUriEdges.${id}`, ...args) as Promise<T>;

describe("ExtensionHost — untitled documents by uri, edges (subprocess)", () => {
    let harness: IExtensionHarness;

    beforeEach(async () => {
        harness = await createExtensionTestHarness({ extensions: [FIXTURE] });
    });

    afterEach(async () => {
        await harness.dispose();
    });

    it("[api:window.showTextDocument] a file in a second group works: control for the untitled case below", async () => {
        const file = harness.writeFile("control.txt", "x");
        expect(await execute(harness, "showInTwoGroups", `file://${file}`)).toEqual({
            returnedColumn: 2,
            tabsPerGroup: [1, 1],
            visibleColumns: [1, 2],
        });
    });

    it.each([
        ["a relative name", "untitled:second-group.txt"],
        ["an absolute path", "untitled:/some/where/second-group.txt"],
    ])("[api:window.showTextDocument] %s opened in a second group is really there", async (_name, uri) => {
        expect(await execute(harness, "showInTwoGroups", uri)).toEqual({
            returnedColumn: 2,
            tabsPerGroup: [1, 1],
            visibleColumns: [1, 2],
        });
    });

    it("[api:TextDocument.isDirty] a document without a path keeps reading as dirty once it is shown", async () => {
        // Upstream sends "mark as dirty" once (mainThreadDocuments.ts:319); showing is no dirty state change.
        expect(await execute(harness, "dirtyAfterShow")).toEqual({ opened: true, shown: true });
    });

    it("[api:TextDocument.isDirty] a document without a path turns clean when its text is removed", async () => {
        // Upstream: untitledTextEditorModel.ts:403, an empty model with no associated path is not dirty.
        expect(await execute(harness, "dirtyAfterEmptying")).toEqual({ typed: true, emptied: false });
    });

    it("[api:TextDocument.isDirty] a document with a path stays dirty when its text is removed", async () => {
        expect(await execute(harness, "dirtyAfterEmptying", "untitled:with-a-path.txt")).toEqual({
            typed: true,
            emptied: true,
        });
    });

    it.each([
        ["open", true],
        ["never opened", false],
    ])(
        "[api:workspace.applyEdit] deleteFile with ignoreIfNotExists on an untitled uri (%s) succeeds",
        async (_name, open) => {
            // Upstream: bulkFileEdits.ts:243, a resource the file service cannot resolve is skipped.
            expect(await execute(harness, "deleteIgnoringMissing", "untitled:nothing-on-disk.txt", open)).toBe(true);
        },
    );

    it("[api:workspace.openTextDocument] an open after the tab closed gives a new document, the old one stays closed", async () => {
        // `vscode.open` with `Untitled-N` gives a clean tab, so closing it asks nothing.
        const uri = "untitled:Untitled-9";
        await execute(harness, "openHeld", uri);
        const group = harness.group.editorGroups.activeGroup;
        const pane = harness.group.getActiveEditor();
        if (pane === null) throw new Error("the document is not shown");
        await harness.group.closeEditor(group, pane);
        await vi.waitFor(async () => {
            expect(await execute(harness, "heldIsClosed", uri)).toBe(true);
        });

        expect(await execute(harness, "reopenHeld", uri)).toEqual({ sameObject: false, oldIsClosed: true });
    });
});
