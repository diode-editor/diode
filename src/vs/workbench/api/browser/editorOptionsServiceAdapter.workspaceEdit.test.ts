import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import type { IBulkEditService } from "../../contrib/bulkEdit/common/iBulkEditService.ts";
import type { BulkEdit } from "../../contrib/bulkEdit/common/workspaceEdit.ts";
import type { IEditorGroupsService } from "../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";
import type { IWireWorkspaceEditOp } from "../common/wireTypes.ts";

import { EditorOptionsServiceAdapter } from "./editorOptionsServiceAdapter.ts";

function spyService(result = true): {
    service: IBulkEditService;
    calls: { edits: BulkEdit; label: string; options?: { respectAutoSaveConfig?: boolean } }[];
} {
    const calls: { edits: BulkEdit; label: string; options?: { respectAutoSaveConfig?: boolean } }[] = [];
    return {
        calls,
        service: {
            applyWorkspaceEdit: (edits, label, options) => {
                calls.push({ edits, label, ...(options ? { options } : {}) });
                return Promise.resolve(result);
            },
        },
    };
}

function emptyGroup(): IEditorService {
    return {
        groupOf: () => ({ id: 1 }),
        activeGroup: { id: 1 },
        viewColumnOf: () => 1,
        groups: [] as unknown[],
        getActiveTabEditor: () => null,
        getEditors: () => [] as unknown[],
    } as unknown as IEditorService;
}

const A = Uri.file("/proj/a.ts");
const B = Uri.file("/proj/b.ts");
const EDIT_A = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, text: "hi" };

function createAdapter(fake: IEditorService, workspaceEdits: IBulkEditService): EditorOptionsServiceAdapter {
    return new EditorOptionsServiceAdapter(fake, fake as unknown as IEditorGroupsService, workspaceEdits);
}

describe("EditorOptionsServiceAdapter.applyWorkspaceEdit", () => {
    it("isRefactoring becomes the executor's respectAutoSaveConfig (files.refactoring.autoSave)", async () => {
        const { service, calls } = spyService();
        const adapter = createAdapter(emptyGroup(), service);
        const ops: IWireWorkspaceEditOp[] = [{ kind: "text", resource: A.toString(), edits: [EDIT_A] }];

        await adapter.applyWorkspaceEdit(ops, { isRefactoring: true });
        await adapter.applyWorkspaceEdit(ops);

        expect(calls.map((call) => call.options)).toEqual([
            { respectAutoSaveConfig: true },
            { respectAutoSaveConfig: false },
        ]);
    });

    it("converts text operations to the edit model WITHOUT clamping and returns the executor's answer", async () => {
        const { service, calls } = spyService();
        const adapter = createAdapter(emptyGroup(), service);

        const applied = await adapter.applyWorkspaceEdit([
            { kind: "text", resource: A.toString(), edits: [EDIT_A] },
            {
                kind: "text",
                resource: B.toString(),
                // Coordinates past the end of the document are passed as is: the executor,
                // which has the resource content, clamps them.
                edits: [{ range: { start: { line: 99, character: 99 }, end: { line: 99, character: 99 } }, text: "z" }],
            },
        ]);

        expect(applied).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0].label).toBe("Workspace Edit");
        expect(calls[0].edits).toEqual([
            {
                resource: A.toString(),
                edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, text: "hi" }],
            },
            {
                resource: B.toString(),
                edits: [{ range: { start: { line: 99, character: 99 }, end: { line: 99, character: 99 } }, text: "z" }],
            },
        ]);
    });

    it("file operations convert to disk paths preserving order and options", async () => {
        const { service, calls } = spyService();
        const adapter = createAdapter(emptyGroup(), service);

        await adapter.applyWorkspaceEdit([
            { kind: "create", resource: B.toString(), contents: "seed", ignoreIfExists: true },
            { kind: "text", resource: B.toString(), edits: [EDIT_A] },
            { kind: "rename", from: A.toString(), to: B.toString(), overwrite: true },
            { kind: "delete", resource: A.toString(), ignoreIfNotExists: true },
        ]);

        expect(calls[0].edits).toEqual([
            { kind: "create", to: "/proj/b.ts", contents: "seed", ignoreIfExists: true },
            {
                resource: B.toString(),
                edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, text: "hi" }],
            },
            { kind: "rename", from: "/proj/a.ts", to: "/proj/b.ts", overwrite: true },
            { kind: "delete", from: "/proj/a.ts", ignoreIfNotExists: true },
        ]);
    });

    it("each option converts separately", async () => {
        const { service, calls } = spyService();
        const adapter = createAdapter(emptyGroup(), service);

        await adapter.applyWorkspaceEdit([
            { kind: "create", resource: B.toString(), overwrite: true },
            { kind: "rename", from: A.toString(), to: B.toString(), ignoreIfExists: true },
        ]);

        expect(calls[0].edits).toEqual([
            { kind: "create", to: "/proj/b.ts", overwrite: true },
            { kind: "rename", from: "/proj/a.ts", to: "/proj/b.ts", ignoreIfExists: true },
        ]);
    });

    it("options without a value stay out of the model (absent ≠ false)", async () => {
        const { service, calls } = spyService();
        const adapter = createAdapter(emptyGroup(), service);

        await adapter.applyWorkspaceEdit([
            { kind: "create", resource: B.toString() },
            { kind: "delete", resource: A.toString() },
            { kind: "rename", from: A.toString(), to: B.toString() },
        ]);

        // Strict comparison: an option without a value must be ABSENT, not
        // arrive as `undefined`; the executor tells them apart by `=== true`.
        expect(calls[0].edits).toStrictEqual([
            { kind: "create", to: "/proj/b.ts" },
            { kind: "delete", from: "/proj/a.ts" },
            { kind: "rename", from: "/proj/a.ts", to: "/proj/b.ts" },
        ]);
    });

    it("executor's answer is not replaced: a refusal reaches the extension as is", async () => {
        const { service } = spyService(false);
        const adapter = createAdapter(emptyGroup(), service);
        expect(await adapter.applyWorkspaceEdit([{ kind: "text", resource: A.toString(), edits: [EDIT_A] }])).toBe(
            false,
        );
    });

    it("empty list yields false: the subprocess answers vacuous success, here it is a junk request", async () => {
        const applyWorkspaceEdit = vi.fn(() => Promise.resolve(true));
        const adapter = createAdapter(emptyGroup(), { applyWorkspaceEdit });
        expect(await adapter.applyWorkspaceEdit([])).toBe(false);
        expect(applyWorkspaceEdit).not.toHaveBeenCalled();
    });

    it.each<IWireWorkspaceEditOp>([
        { kind: "create", resource: "output:extensions" },
        { kind: "delete", resource: "output:extensions" },
        { kind: "rename", from: "output:extensions", to: A.toString() },
        { kind: "rename", from: A.toString(), to: "output:extensions" },
    ])("file operation on a non-disk resource rejects the whole edit (%o)", async (op) => {
        const applyWorkspaceEdit = vi.fn(() => Promise.resolve(true));
        const adapter = createAdapter(emptyGroup(), { applyWorkspaceEdit });

        const applied = await adapter.applyWorkspaceEdit([
            { kind: "text", resource: A.toString(), edits: [EDIT_A] },
            op,
        ]);

        expect(applied).toBe(false);
        expect(applyWorkspaceEdit).not.toHaveBeenCalled();
    });

    it("text edit of a non-disk resource converts (an open buffer may hold it)", async () => {
        const { service, calls } = spyService();
        const adapter = createAdapter(emptyGroup(), service);

        await adapter.applyWorkspaceEdit([{ kind: "text", resource: "untitled:Untitled-1", edits: [EDIT_A] }]);

        expect(calls[0].edits).toEqual([
            {
                resource: "untitled:Untitled-1",
                edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, text: "hi" }],
            },
        ]);
    });

    it("a text operation carries its line ending; none stays out of the model", async () => {
        const { service, calls } = spyService();
        const adapter = createAdapter(emptyGroup(), service);

        await adapter.applyWorkspaceEdit([
            { kind: "text", resource: A.toString(), edits: [], setEndOfLine: 2 },
            { kind: "text", resource: B.toString(), edits: [EDIT_A] },
        ]);

        expect(calls[0].edits).toStrictEqual([
            { resource: A.toString(), edits: [], setEndOfLine: 2 },
            { resource: B.toString(), edits: [EDIT_A] },
        ]);
    });

    it("create decodes binary contents from base64; none stays out of the model", async () => {
        const { service, calls } = spyService();
        const adapter = createAdapter(emptyGroup(), service);

        await adapter.applyWorkspaceEdit([
            { kind: "create", resource: A.toString(), contentsBase64: "AAE=" },
            { kind: "create", resource: B.toString() },
        ]);

        expect(calls[0].edits).toStrictEqual([
            { kind: "create", to: "/proj/a.ts", contents: Buffer.from([0, 1]) },
            { kind: "create", to: "/proj/b.ts" },
        ]);
    });
});
