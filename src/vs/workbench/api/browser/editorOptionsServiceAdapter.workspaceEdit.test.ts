import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import type { IBulkEditService } from "../../contrib/bulkEdit/common/iBulkEditService.ts";
import type { BulkEdit } from "../../contrib/bulkEdit/common/workspaceEdit.ts";
import type { IEditorGroupsService } from "../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";
import type { IWireWorkspaceEditOp } from "../common/wireTypes.ts";

import { EditorOptionsServiceAdapter } from "./editorOptionsServiceAdapter.ts";

// `applyWorkspaceEdit` в адаптере — ПЕРЕВОДЧИК: wire-операции в модель правок
// ядра, ответ — ответ исполнителя. Сама семантика применения (all-or-nothing,
// закрытые файлы, один шаг отмены) живёт и проверяется в
// `contrib/bulkEdit/node/workspaceEditService`.

/** Исполнитель-шпион: запоминает модель, с которой его позвали. */
function spyService(result = true): { service: IBulkEditService; calls: { edits: BulkEdit; label: string }[] } {
    const calls: { edits: BulkEdit; label: string }[] = [];
    return {
        calls,
        service: {
            applyWorkspaceEdit: (edits, label) => {
                calls.push({ edits, label });
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
const EDIT_A = { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 2 }, text: "hi" };

/** Фейк сервиса редакторов отвечает и за полосу групп (groupOf/activeGroup/viewColumnOf). */
function createAdapter(fake: IEditorService, workspaceEdits: IBulkEditService): EditorOptionsServiceAdapter {
    return new EditorOptionsServiceAdapter(fake, fake as unknown as IEditorGroupsService, workspaceEdits);
}

describe("EditorOptionsServiceAdapter.applyWorkspaceEdit", () => {
    it("переводит текстовые операции в модель правок БЕЗ клампа и отдаёт ответ исполнителя", async () => {
        const { service, calls } = spyService();
        const adapter = createAdapter(emptyGroup(), service);

        const applied = await adapter.applyWorkspaceEdit([
            { kind: "text", resource: A.toString(), edits: [EDIT_A] },
            {
                kind: "text",
                resource: B.toString(),
                // Координаты за концом документа едут как есть: клампит их
                // исполнитель, у которого есть содержимое ресурса.
                edits: [{ range: { startLine: 99, startCharacter: 99, endLine: 99, endCharacter: 99 }, text: "z" }],
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

    it("файловые операции переводятся в пути на диске с сохранением порядка и опций", async () => {
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

    it("каждая опция переводится по отдельности", async () => {
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

    it("опции без значения не попадают в модель (отсутствие ≠ false)", async () => {
        const { service, calls } = spyService();
        const adapter = createAdapter(emptyGroup(), service);

        await adapter.applyWorkspaceEdit([
            { kind: "create", resource: B.toString() },
            { kind: "delete", resource: A.toString() },
            { kind: "rename", from: A.toString(), to: B.toString() },
        ]);

        // Строгое сравнение: опция без значения обязана ОТСУТСТВОВАТЬ, а не
        // приехать как `undefined` — исполнитель различает их по `=== true`.
        expect(calls[0].edits).toStrictEqual([
            { kind: "create", to: "/proj/b.ts" },
            { kind: "delete", from: "/proj/a.ts" },
            { kind: "rename", from: "/proj/a.ts", to: "/proj/b.ts" },
        ]);
    });

    it("ответ исполнителя не подменяется: отказ едет расширению как есть", async () => {
        const { service } = spyService(false);
        const adapter = createAdapter(emptyGroup(), service);
        expect(await adapter.applyWorkspaceEdit([{ kind: "text", resource: A.toString(), edits: [EDIT_A] }])).toBe(
            false,
        );
    });

    it("пустой список — false: вакуумный успех отвечает субпроцесс, здесь это мусорный запрос", async () => {
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
    ])("файловая операция по недисковому ресурсу отбивает весь edit (%o)", async (op) => {
        const applyWorkspaceEdit = vi.fn(() => Promise.resolve(true));
        const adapter = createAdapter(emptyGroup(), { applyWorkspaceEdit });

        const applied = await adapter.applyWorkspaceEdit([
            { kind: "text", resource: A.toString(), edits: [EDIT_A] },
            op,
        ]);

        expect(applied).toBe(false);
        expect(applyWorkspaceEdit).not.toHaveBeenCalled();
    });

    it("текстовая правка недискового ресурса переводится (его может держать открытый буфер)", async () => {
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
});
