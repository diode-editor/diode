import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import type { TextFileModelService } from "../../../services/textfile/common/textFileModelService.ts";

import { BulkEditBuffers } from "./bulkEditBuffers.ts";

interface IFakePane {
    uri: Uri;
    readOnly: boolean;
    undoContext: string;
    label: string;
    isModified: boolean;
    save: ReturnType<typeof vi.fn>;
    getText: () => string;
    applyExternalEditsDetached: ReturnType<typeof vi.fn>;
}

function pane(file: string, overrides: Partial<IFakePane> = {}): IFakePane {
    return {
        uri: Uri.file(file),
        readOnly: false,
        undoContext: `ctx:${file}`,
        label: file.split("/").at(-1) ?? file,
        isModified: true,
        save: vi.fn(() => Promise.resolve("saved")),
        getText: () => `text of ${file}`,
        applyExternalEditsDetached: vi.fn(() => ({ label: "s", resources: [], undo: () => {}, redo: () => {} })),
        ...overrides,
    };
}

function fakes({
    active = null,
    rest = [],
    models = new Set<string>(),
}: {
    active?: IFakePane | null;
    rest?: IFakePane[];
    models?: Set<string>;
} = {}): [IEditorService, TextFileModelService] {
    const editors = {
        getActiveTabEditor: () => active,
        // The active tab comes LAST: this shows the target is picked by
        // activity, not "whichever comes first".
        getEditors: () => (active === null ? rest : [...rest, active]),
        getFileModelsWithoutEditor: () => [],
    } as unknown as IEditorService;
    const registry = {
        get: (uri: Uri) => (models.has(uri.toString()) ? {} : null),
    } as unknown as TextFileModelService;
    return [editors, registry];
}

const A = "/proj/a.ts";
const B = "/proj/b.ts";

describe("BulkEditBuffers.get", () => {
    it("the resource's tab is the buffer: text and edits go through it", () => {
        const active = pane(A);
        const buffers = new BulkEditBuffers(...fakes({ active }));

        const target = buffers.get(active.uri.toString());
        expect(target).not.toBeNull();
        expect(target).not.toBe("read-only");
        if (target === null || target === "read-only") return;

        expect(target.text()).toBe(`text of ${A}`);
        const edit = createTextEdit(createRange(0, 0, 0, 1), "x");
        target.applyEdits([edit], "Workspace Edit");
        expect(active.applyExternalEditsDetached).toHaveBeenCalledExactlyOnceWith([edit], "Workspace Edit");
    });

    it("save saves only the changed buffer (files.refactoring.autoSave)", async () => {
        const dirty = pane(A);
        const clean = pane(B, { isModified: false });
        const buffers = new BulkEditBuffers(...fakes({ active: dirty, rest: [clean] }));

        const targets = [buffers.get(dirty.uri.toString()), buffers.get(clean.uri.toString())];
        for (const target of targets) {
            if (target === null || target === "read-only") throw new Error("expected a buffer");
            await target.save();
        }

        expect(dirty.save).toHaveBeenCalledOnce();
        expect(clean.save).not.toHaveBeenCalled();
    });

    it("a resource with no tab and no model is null: the disk edits it", () => {
        const buffers = new BulkEditBuffers(...fakes({ active: pane(A) }));
        expect(buffers.get(Uri.file(B).toString())).toBeNull();
    });

    it('a read-only tab is "read-only": the edit is refused entirely', () => {
        const ro = pane(B, { readOnly: true });
        const buffers = new BulkEditBuffers(...fakes({ active: pane(A), rest: [ro] }));
        expect(buffers.get(ro.uri.toString())).toBe("read-only");
    });

    it('a model of someone else (a diff side) without a tab is "read-only": no writing past the live buffer', () => {
        const resource = Uri.file(B).toString();
        const buffers = new BulkEditBuffers(...fakes({ active: pane(A), models: new Set([resource]) }));
        expect(buffers.get(resource)).toBe("read-only");
    });

    it("the edit targets the ACTIVE tab of the resource, not the first one found", () => {
        const active = pane(A, { undoContext: "ctx:active" });
        const other = pane(A, { undoContext: "ctx:other" });
        const buffers = new BulkEditBuffers(...fakes({ active, rest: [other] }));

        const target = buffers.get(active.uri.toString());
        if (target === null || target === "read-only") throw new Error("expected a buffer");
        target.applyEdits([], "Workspace Edit");

        expect(active.applyExternalEditsDetached).toHaveBeenCalledOnce();
        expect(other.applyExternalEditsDetached).not.toHaveBeenCalled();
    });

    it("an inactive tab of the resource is found too (the edit targets the document)", () => {
        const other = pane(B);
        const buffers = new BulkEditBuffers(...fakes({ active: pane(A), rest: [other] }));
        expect(buffers.get(other.uri.toString())).not.toBeNull();
    });
});

describe("BulkEditBuffers.undoParticipants", () => {
    it("every tab of a touched resource is a participant with its own edit (Ctrl+Z from any)", () => {
        const active = pane(A);
        const other = pane(B);
        const buffers = new BulkEditBuffers(...fakes({ active, rest: [other] }));

        expect(buffers.undoParticipants([other.uri.toString(), active.uri.toString()])).toEqual([
            { context: `ctx:${B}`, label: "b.ts", owner: true },
            { context: `ctx:${A}`, label: "a.ts", owner: true },
        ]);
    });

    it("a split of one document is one participant: they share the bucket", () => {
        const active = pane(A);
        const split = pane(A);
        const buffers = new BulkEditBuffers(...fakes({ active, rest: [split, pane(B)] }));

        expect(buffers.undoParticipants([active.uri.toString(), Uri.file(B).toString()])).toEqual([
            { context: `ctx:${A}`, label: "a.ts", owner: true },
            { context: `ctx:${B}`, label: "b.ts", owner: true },
        ]);
    });

    it("no touched resource is open: the anchor is the active tab, without its own edit", () => {
        const active = pane(A);
        const buffers = new BulkEditBuffers(...fakes({ active }));

        const anchor = [{ context: `ctx:${A}`, label: "a.ts", owner: false }];
        expect(buffers.undoParticipants([])).toEqual(anchor);
        expect(buffers.undoParticipants([Uri.file("/proj/closed.ts").toString()])).toEqual(anchor);
    });

    it("no tabs at all means no participants: the step goes to the workspace operations bucket", () => {
        const buffers = new BulkEditBuffers(...fakes());
        expect(buffers.undoParticipants([])).toEqual([]);
        expect(buffers.undoParticipants([Uri.file(A).toString()])).toEqual([]);
    });
});

describe("BulkEditBuffers.didDelete", () => {
    it("a delete bypassing the file service goes to EditorService.handleDeletedFile with the same resource", () => {
        const handleDeletedFile = vi.fn();
        const [, registry] = fakes();
        const editors = { handleDeletedFile } as unknown as IEditorService;
        const buffers = new BulkEditBuffers(editors, registry);

        buffers.didDelete(Uri.file("/proj/src").toString());

        expect(handleDeletedFile).toHaveBeenCalledTimes(1);
        expect((handleDeletedFile.mock.calls[0][0] as Uri).fsPath).toBe(Uri.file("/proj/src").fsPath);
    });
});
