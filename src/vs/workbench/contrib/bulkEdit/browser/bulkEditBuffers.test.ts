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

describe("BulkEditBuffers — models without a tab", () => {
    const uri = Uri.file(A);
    const edits = [createTextEdit(createRange(0, 0, 0, 0), "x")];
    const step = (log: string[], name: string) => ({
        label: "s",
        resources: [],
        undo: () => {
            log.push(`undo ${name}`);
        },
        redo: () => {
            log.push(`redo ${name}`);
        },
    });
    const model = (log: string[], name: string, overrides: object = {}) => ({
        uri,
        undoContext: `model:${name}`,
        isTooLargeForTokenization: false,
        isModified: false,
        applyExternalEditsDetached: vi.fn(() => step(log, name)),
        ...overrides,
    });
    const setup = (first: object, second: object = first) => {
        const registry = { current: first as object | null };
        const editors = {
            getActiveTabEditor: () => null,
            getEditors: () => [],
            getFileModelsWithoutEditor: () => [registry.current],
            holdFileModel: vi.fn((): object => {
                registry.current = second;
                return second;
            }),
            revertSoftBeforeDelete: vi.fn(),
        };
        const models = { get: () => registry.current };
        return {
            registry,
            editors,
            buffers: new BulkEditBuffers(
                editors as unknown as IEditorService,
                models as unknown as TextFileModelService,
            ),
        };
    };

    it("a model in the large-file mode refuses the edit: it is read-only and extensions don't see it", () => {
        const { buffers } = setup(model([], "large", { isTooLargeForTokenization: true }));
        expect(buffers.get(uri.toString())).toBe("read-only");
        expect(buffers.open(uri.toString())).toBe("read-only");
    });

    it("redo after the model was let go replays the edits on a new one, undo then goes to it", () => {
        const log: string[] = [];
        const second = model(log, "second");
        const { buffers, registry } = setup(model(log, "first"), second);
        const target = buffers.get(uri.toString());
        if (target === null || target === "read-only") throw new Error("no buffer");
        const element = target.applyEdits(edits, "label");
        if (element === null) throw new Error("no step");

        void element.undo();
        registry.current = null;
        expect(element.canUndo?.()).toBe(false);
        expect(element.canRedo?.()).toBe(true);

        void element.redo();
        expect(second.applyExternalEditsDetached).toHaveBeenCalledExactlyOnceWith(edits, "label");
        expect(element.canUndo?.()).toBe(true);
        void element.undo();
        expect(log).toEqual(["undo first", "undo second"]);
    });

    it("redo with a live model is the model's own step", () => {
        const log: string[] = [];
        const { buffers, editors } = setup(model(log, "first"));
        const target = buffers.get(uri.toString());
        if (target === null || target === "read-only") throw new Error("no buffer");
        void target.applyEdits(edits, "label")?.redo();
        expect(log).toEqual(["redo first"]);
        expect(editors.holdFileModel).not.toHaveBeenCalled();
    });

    it("the model of a touched resource takes part in the step, so a tab opened later undoes it", () => {
        const { buffers } = setup(model([], "first"));
        expect(buffers.undoParticipants([uri.toString()])).toEqual([
            { context: "model:first", label: "a.ts", owner: false },
        ]);
    });

    const bufferOf = (buffers: BulkEditBuffers) => {
        const target = buffers.get(uri.toString());
        if (target === null || target === "read-only") throw new Error("no buffer");
        return target;
    };
    const gated = (answer: boolean) => ({
        label: "s",
        resources: [],
        canUndo: () => answer,
        canRedo: () => answer,
        undo: () => {},
        redo: () => {},
    });

    it.each([
        [true, true],
        [false, false],
    ])("an edit step over a live model answers as the model's step: %s", (answer, expected) => {
        const { buffers } = setup(model([], "first", { applyExternalEditsDetached: () => gated(answer) }));
        const element = bufferOf(buffers).applyEdits(edits, "label");
        expect(element?.canUndo?.()).toBe(expected);
        expect(element?.canRedo?.()).toBe(expected);
    });

    it("a live model's step without its own answer allows undo and redo", () => {
        const { buffers } = setup(model([], "first"));
        const element = bufferOf(buffers).applyEdits(edits, "label");
        expect(element?.canUndo?.()).toBe(true);
        expect(element?.canRedo?.()).toBe(true);
    });

    it("edits that changed nothing are no step", () => {
        const { buffers } = setup(model([], "first", { applyExternalEditsDetached: () => null }));
        expect(bufferOf(buffers).applyEdits(edits, "label")).toBeNull();
    });

    it("redo with nothing to open refuses, naming the resource", () => {
        const { buffers, registry, editors } = setup(model([], "first"));
        const element = bufferOf(buffers).applyEdits(edits, "label");
        registry.current = null;
        editors.holdFileModel.mockReturnValueOnce(null as unknown as object);
        expect(() => element?.redo()).toThrow(`No model for ${uri.toString()}`);
    });

    it.each([
        [true, true, false],
        [false, false, true],
    ])("an EOL step answers as the model's while it lives, and refuses after: %s", (answer, expected, dead) => {
        const { buffers, registry } = setup(model([], "first", { setEolDetached: () => gated(answer) }));
        const element = bufferOf(buffers).setEol(2);
        if (dead) registry.current = null;
        expect(element?.canUndo?.()).toBe(dead ? false : expected);
        expect(element?.canRedo?.()).toBe(dead ? false : expected);
    });

    it("an EOL step without its own answer allows undo and redo; no change of the ending is no step", () => {
        const { buffers } = setup(
            model([], "first", { setEolDetached: vi.fn(() => step([], "eol")).mockReturnValueOnce(step([], "eol")) }),
        );
        const element = bufferOf(buffers).setEol(2);
        expect(element?.canUndo?.()).toBe(true);
        expect(element?.canRedo?.()).toBe(true);

        const same = setup(model([], "first", { setEolDetached: () => null }));
        expect(bufferOf(same.buffers).setEol(2)).toBeNull();
    });

    it("save writes a modified model and leaves a clean one", async () => {
        const save = vi.fn(() => Promise.resolve("saved"));
        await bufferOf(setup(model([], "first", { isModified: false, save })).buffers).save();
        expect(save).not.toHaveBeenCalled();
        await bufferOf(setup(model([], "first", { isModified: true, save })).buffers).save();
        expect(save).toHaveBeenCalledOnce();
    });

    it("didReplaceOnDisk reloads an open model; no model is nothing to do", () => {
        const revertToDisk = vi.fn();
        const { buffers, registry } = setup(model([], "first", { revertToDisk }));
        buffers.didReplaceOnDisk(uri.toString());
        expect(revertToDisk).toHaveBeenCalledOnce();
        registry.current = null;
        expect(() => {
            buffers.didReplaceOnDisk(uri.toString());
        }).not.toThrow();
    });

    it("willDelete reverts softly at the resource", () => {
        const { buffers, editors } = setup(model([], "first"));
        buffers.willDelete(uri.toString());
        expect(editors.revertSoftBeforeDelete.mock.calls.map(([resource]: unknown[]) => String(resource))).toEqual([
            uri.toString(),
        ]);
    });
});
