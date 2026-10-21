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
    } as unknown as IEditorService;
    const registry = {
        get: (uri: Uri) => (models.has(uri.toString()) ? {} : null),
    } as unknown as TextFileModelService;
    return [editors, registry];
}

const A = "/proj/a.ts";
const B = "/proj/b.ts";

describe("BulkEditBuffers.get", () => {
    it("вкладка ресурса — буфер: текст и правки идут через неё", () => {
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

    it("save сохраняет только изменённый буфер (files.refactoring.autoSave)", async () => {
        const dirty = pane(A);
        const clean = pane(B, { isModified: false });
        const buffers = new BulkEditBuffers(...fakes({ active: dirty, rest: [clean] }));

        const targets = [buffers.get(dirty.uri.toString()), buffers.get(clean.uri.toString())];
        for (const target of targets) {
            if (target === null || target === "read-only") throw new Error("ожидался буфер");
            await target.save();
        }

        expect(dirty.save).toHaveBeenCalledOnce();
        expect(clean.save).not.toHaveBeenCalled();
    });

    it("ресурс без вкладки и без модели — null: его правит диск", () => {
        const buffers = new BulkEditBuffers(...fakes({ active: pane(A) }));
        expect(buffers.get(Uri.file(B).toString())).toBeNull();
    });

    it('read-only вкладка — "read-only": edit отбивается целиком', () => {
        const ro = pane(B, { readOnly: true });
        const buffers = new BulkEditBuffers(...fakes({ active: pane(A), rest: [ro] }));
        expect(buffers.get(ro.uri.toString())).toBe("read-only");
    });

    it('модель в реестре без вкладки — "read-only": писать мимо живого буфера нельзя', () => {
        const resource = Uri.file(B).toString();
        const buffers = new BulkEditBuffers(...fakes({ active: pane(A), models: new Set([resource]) }));
        expect(buffers.get(resource)).toBe("read-only");
    });

    it("правка адресуется АКТИВНОЙ вкладке ресурса, а не первой найденной", () => {
        const active = pane(A, { undoContext: "ctx:active" });
        const other = pane(A, { undoContext: "ctx:other" });
        const buffers = new BulkEditBuffers(...fakes({ active, rest: [other] }));

        const target = buffers.get(active.uri.toString());
        if (target === null || target === "read-only") throw new Error("ожидался буфер");
        target.applyEdits([], "Workspace Edit");

        expect(active.applyExternalEditsDetached).toHaveBeenCalledOnce();
        expect(other.applyExternalEditsDetached).not.toHaveBeenCalled();
    });

    it("неактивная вкладка ресурса тоже находится (правка адресует документ)", () => {
        const other = pane(B);
        const buffers = new BulkEditBuffers(...fakes({ active: pane(A), rest: [other] }));
        expect(buffers.get(other.uri.toString())).not.toBeNull();
    });
});

describe("BulkEditBuffers.undoParticipants", () => {
    it("каждая вкладка тронутого ресурса — участник со своей правкой (Ctrl+Z из любой)", () => {
        const active = pane(A);
        const other = pane(B);
        const buffers = new BulkEditBuffers(...fakes({ active, rest: [other] }));

        expect(buffers.undoParticipants([other.uri.toString(), active.uri.toString()])).toEqual([
            { context: `ctx:${B}`, label: "b.ts", owner: true },
            { context: `ctx:${A}`, label: "a.ts", owner: true },
        ]);
    });

    it("сплит одного документа — один участник: бакет у них общий", () => {
        const active = pane(A);
        const split = pane(A);
        const buffers = new BulkEditBuffers(...fakes({ active, rest: [split, pane(B)] }));

        expect(buffers.undoParticipants([active.uri.toString(), Uri.file(B).toString()])).toEqual([
            { context: `ctx:${A}`, label: "a.ts", owner: true },
            { context: `ctx:${B}`, label: "b.ts", owner: true },
        ]);
    });

    it("ни один тронутый ресурс не открыт — якорь на активной вкладке, без своей правки", () => {
        const active = pane(A);
        const buffers = new BulkEditBuffers(...fakes({ active }));

        const anchor = [{ context: `ctx:${A}`, label: "a.ts", owner: false }];
        expect(buffers.undoParticipants([])).toEqual(anchor);
        expect(buffers.undoParticipants([Uri.file("/proj/closed.ts").toString()])).toEqual(anchor);
    });

    it("вкладок нет вовсе — участников нет: шаг уйдёт в бакет workspace-операций", () => {
        const buffers = new BulkEditBuffers(...fakes());
        expect(buffers.undoParticipants([])).toEqual([]);
        expect(buffers.undoParticipants([Uri.file(A).toString()])).toEqual([]);
    });
});

describe("BulkEditBuffers.didDelete", () => {
    it("удаление мимо файлового сервиса уходит в EditorService.handleDeletedFile тем же ресурсом", () => {
        const handleDeletedFile = vi.fn();
        const [, registry] = fakes();
        const editors = { handleDeletedFile } as unknown as IEditorService;
        const buffers = new BulkEditBuffers(editors, registry);

        buffers.didDelete(Uri.file("/proj/src").toString());

        expect(handleDeletedFile).toHaveBeenCalledTimes(1);
        expect((handleDeletedFile.mock.calls[0][0] as Uri).fsPath).toBe(Uri.file("/proj/src").fsPath);
    });
});
