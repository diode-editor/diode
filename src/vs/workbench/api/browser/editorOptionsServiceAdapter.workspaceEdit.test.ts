import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import type { EditorService } from "../../services/editor/browser/editorService.ts";

import { EditorOptionsServiceAdapter } from "./editorOptionsServiceAdapter.ts";

// `applyWorkspaceEdit` (RPC `workspace.applyEdit`): применение текстовых правок
// по ресурсам. Ключевое свойство — all-or-nothing: закрытый или read-only
// ресурс отменяет ВЕСЬ edit до того, как тронут хоть один документ.

interface IFakeEditor {
    uri: Uri;
    readOnly?: boolean;
    model: { document: { lineCount: number; getLineLength(line: number): number } };
    applyExternalEdits: ReturnType<typeof vi.fn>;
}

function makeEditor(path: string, readOnly = false): IFakeEditor {
    return {
        uri: Uri.file(path),
        readOnly,
        model: { document: { lineCount: 5, getLineLength: () => 10 } },
        applyExternalEdits: vi.fn(),
    };
}

/** Группа: `active` — активная вкладка, `rest` — вкладки других ресурсов. */
function makeGroup(active: IFakeEditor | null, rest: IFakeEditor[] = []): EditorService {
    return {
        groupOf: () => ({ id: 1 }),
        activeGroup: { id: 1 },
        viewColumnOf: () => 1,
        groups: [] as unknown[],
        getActiveTabEditor: () => active,
        getEditors: () => rest,
    } as unknown as EditorService;
}

const EDIT_A = { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 2 }, text: "hi" };
const EDIT_B = { range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 1 }, text: "" };

describe("EditorOptionsServiceAdapter.applyWorkspaceEdit", () => {
    it("применяет правки к каждому документу своим батчем с меткой workspace edit", () => {
        const active = makeEditor("/proj/a.ts");
        const other = makeEditor("/proj/b.ts");
        const adapter = new EditorOptionsServiceAdapter(makeGroup(active, [other]));

        const applied = adapter.applyWorkspaceEdit([
            { resource: active.uri.toString(), edits: [EDIT_A] },
            { resource: other.uri.toString(), edits: [EDIT_B] },
        ]);

        expect(applied).toBe(true);
        expect(active.applyExternalEdits).toHaveBeenCalledExactlyOnceWith(
            [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, text: "hi" }],
            "workspace edit",
        );
        expect(other.applyExternalEdits).toHaveBeenCalledExactlyOnceWith(
            [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }, text: "" }],
            "workspace edit",
        );
    });

    it("клампит координаты правок к границам документа", () => {
        const active = makeEditor("/proj/a.ts");
        const adapter = new EditorOptionsServiceAdapter(makeGroup(active));

        adapter.applyWorkspaceEdit([
            {
                resource: active.uri.toString(),
                edits: [{ range: { startLine: -3, startCharacter: -1, endLine: 99, endCharacter: 99 }, text: "z" }],
            },
        ]);

        expect(active.applyExternalEdits.mock.calls[0][0]).toEqual([
            { range: { start: { line: 0, character: 0 }, end: { line: 4, character: 10 } }, text: "z" },
        ]);
    });

    it("all-or-nothing: закрытый ресурс отменяет весь edit, открытые не трогаются", () => {
        const active = makeEditor("/proj/a.ts");
        const adapter = new EditorOptionsServiceAdapter(makeGroup(active));

        const applied = adapter.applyWorkspaceEdit([
            { resource: active.uri.toString(), edits: [EDIT_A] },
            { resource: Uri.file("/proj/closed.ts").toString(), edits: [EDIT_B] },
        ]);

        expect(applied).toBe(false);
        expect(active.applyExternalEdits).not.toHaveBeenCalled();
    });

    it("all-or-nothing: read-only ресурс отменяет весь edit", () => {
        const active = makeEditor("/proj/a.ts");
        const readOnly = makeEditor("/proj/ro.ts", true);
        const adapter = new EditorOptionsServiceAdapter(makeGroup(active, [readOnly]));

        const applied = adapter.applyWorkspaceEdit([
            { resource: active.uri.toString(), edits: [EDIT_A] },
            { resource: readOnly.uri.toString(), edits: [EDIT_B] },
        ]);

        expect(applied).toBe(false);
        expect(active.applyExternalEdits).not.toHaveBeenCalled();
        expect(readOnly.applyExternalEdits).not.toHaveBeenCalled();
    });

    it("пустой список — false: вакуумный успех отвечает субпроцесс, здесь это мусорный запрос", () => {
        const adapter = new EditorOptionsServiceAdapter(makeGroup(makeEditor("/proj/a.ts")));
        expect(adapter.applyWorkspaceEdit([])).toBe(false);
    });

    /**
     * Перекрытые правки документ применил бы снизу вверх по уже съеденному
     * тексту — тихая порча содержимого и сломанный undo. vscode такой edit
     * отбивает («Overlapping ranges are not allowed»), и отказ обязан быть
     * all-or-nothing: ресурс с пересечением отменяет весь edit.
     */
    it("all-or-nothing: пересекающиеся правки одного ресурса отменяют весь edit", () => {
        const active = makeEditor("/proj/a.ts");
        const other = makeEditor("/proj/b.ts");
        const adapter = new EditorOptionsServiceAdapter(makeGroup(active, [other]));

        const applied = adapter.applyWorkspaceEdit([
            { resource: active.uri.toString(), edits: [EDIT_A] },
            {
                resource: other.uri.toString(),
                edits: [
                    { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 4 }, text: "x" },
                    { range: { startLine: 0, startCharacter: 2, endLine: 0, endCharacter: 6 }, text: "y" },
                ],
            },
        ]);

        expect(applied).toBe(false);
        expect(active.applyExternalEdits).not.toHaveBeenCalled();
        expect(other.applyExternalEdits).not.toHaveBeenCalled();
    });

    it("правки встык и две вставки в одну точку пересечением не считаются", () => {
        const active = makeEditor("/proj/a.ts");
        const adapter = new EditorOptionsServiceAdapter(makeGroup(active));

        const applied = adapter.applyWorkspaceEdit([
            {
                resource: active.uri.toString(),
                edits: [
                    // Встык: конец первой = начало второй.
                    { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 2 }, text: "x" },
                    { range: { startLine: 0, startCharacter: 2, endLine: 0, endCharacter: 4 }, text: "y" },
                    // Две вставки нулевой ширины в одну точку.
                    { range: { startLine: 1, startCharacter: 1, endLine: 1, endCharacter: 1 }, text: "p" },
                    { range: { startLine: 1, startCharacter: 1, endLine: 1, endCharacter: 1 }, text: "q" },
                ],
            },
        ]);

        expect(applied).toBe(true);
        expect(active.applyExternalEdits).toHaveBeenCalledOnce();
    });
});
