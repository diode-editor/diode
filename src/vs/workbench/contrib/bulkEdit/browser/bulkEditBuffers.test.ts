import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import type { TextFileModelService } from "../../../services/textfile/common/textFileModelService.ts";

import { BulkEditBuffers } from "./bulkEditBuffers.ts";

// Кто «открыт» с точки зрения bulk edit'а и в какой бакет истории ложится его
// единственный шаг. «Открыт» — это не только вкладка: модель файла может жить в
// реестре без вкладки (сторона диффа), и писать мимо неё на диск нельзя.

interface IFakePane {
    uri: Uri;
    readOnly: boolean;
    undoContext: string;
    getText: () => string;
    applyExternalEditsDetached: ReturnType<typeof vi.fn>;
}

function pane(file: string, overrides: Partial<IFakePane> = {}): IFakePane {
    return {
        uri: Uri.file(file),
        readOnly: false,
        undoContext: `ctx:${file}`,
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
} = {}): [EditorService, TextFileModelService] {
    const editors = {
        getActiveTabEditor: () => active,
        // Активная вкладка идёт ПОСЛЕДНЕЙ: так видно, что адресат выбирается по
        // активности, а не «первым попавшимся».
        getEditors: () => (active === null ? rest : [...rest, active]),
    } as unknown as EditorService;
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

describe("BulkEditBuffers.undoContext", () => {
    it("тронута активная вкладка — её бакет (Ctrl+Z там, где вызвали действие)", () => {
        const active = pane(A);
        const other = pane(B);
        const buffers = new BulkEditBuffers(...fakes({ active, rest: [other] }));

        expect(buffers.undoContext([other.uri.toString(), active.uri.toString()])).toBe(`ctx:${A}`);
    });

    it("активная вкладка не тронута — бакет первого тронутого ресурса", () => {
        const active = pane(A);
        const other = pane(B);
        const buffers = new BulkEditBuffers(...fakes({ active, rest: [other] }));

        expect(buffers.undoContext([other.uri.toString()])).toBe(`ctx:${B}`);
    });

    it("ни один тронутый ресурс не открыт — бакет активной вкладки (действие вызвали из неё)", () => {
        const active = pane(A);
        const buffers = new BulkEditBuffers(...fakes({ active }));

        expect(buffers.undoContext([])).toBe(`ctx:${A}`);
        expect(buffers.undoContext([Uri.file("/proj/closed.ts").toString()])).toBe(`ctx:${A}`);
    });

    it("вкладок нет вовсе — null: шаг уйдёт в бакет workspace-операций", () => {
        const buffers = new BulkEditBuffers(...fakes());
        expect(buffers.undoContext([])).toBeNull();
        expect(buffers.undoContext([Uri.file(A).toString()])).toBeNull();
    });
});
