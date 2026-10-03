import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit, type ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { TrashService } from "../../../../platform/files/node/trashService.ts";
import type { IUndoRedoElement } from "../../../../platform/undoRedo/common/iUndoRedoElement.ts";
import { UndoRedoService, WORKSPACE_UNDO_CONTEXT } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { BulkEditTarget, IBulkEditBuffers } from "../common/iBulkEditBuffers.ts";
import { NULL_BULK_EDIT_BUFFERS } from "../common/iBulkEditBuffers.ts";
import type { BulkEditOperation } from "../common/workspaceEdit.ts";

import { WorkspaceEditService } from "./workspaceEditService.ts";

// `workspace.applyEdit` — ядро узла M1: правки по ЗАКРЫТЫМ файлам, файловые
// операции и ОДИН шаг отмены на весь edit. Контракт here-and-now: edit либо
// применяется целиком, либо не применяется вовсе.

let tmpDir: string;
let ws: ITempWorkspace;
let savedXdg: string | undefined;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-wes-bulk-" });
    tmpDir = ws.dir;
    savedXdg = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = path.join(tmpDir, "data");
});

afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    ws.dispose();
});

const NO_TRASH: IConfigurationService = {
    ...NULL_CONFIGURATION_SERVICE,
    get<T>(key: string, def?: T): T | undefined {
        return key === "files.enableTrash" ? (false as unknown as T) : def;
    },
};

/** Открытый буфер-двойник: текст в памяти + записанный шаг истории. */
interface IFakeBuffer {
    text: string;
    readonly applied: ITextEdit[][];
    step: IUndoRedoElement | null;
}

function makeBuffers(open: Map<string, IFakeBuffer>, readOnly = new Set<string>()): IBulkEditBuffers {
    return {
        get: (resource): BulkEditTarget => {
            if (readOnly.has(resource)) return "read-only";
            const buffer = open.get(resource);
            if (buffer === undefined) return null;
            return {
                text: () => buffer.text,
                applyEdits: (edits) => {
                    buffer.applied.push([...edits]);
                    buffer.text = applyToText(buffer.text, edits);
                    return buffer.step;
                },
            };
        },
        undoContext: (touched) => (touched.length > 0 ? `buffer:${touched[0]}` : null),
    };
}

/** Применение правок к строке — только для проверки двойника буфера. */
function applyToText(text: string, edits: readonly ITextEdit[]): string {
    const lines = text.split("\n");
    for (const edit of [...edits].reverse()) {
        const before = lines[edit.range.start.line].slice(0, edit.range.start.character);
        const after = lines[edit.range.end.line].slice(edit.range.end.character);
        lines.splice(
            edit.range.start.line,
            edit.range.end.line - edit.range.start.line + 1,
            before + edit.text + after,
        );
    }
    return lines.join("\n");
}

function makeService(buffers: IBulkEditBuffers = NULL_BULK_EDIT_BUFFERS): {
    service: WorkspaceEditService;
    undoRedo: UndoRedoService;
} {
    const undoRedo = new UndoRedoService();
    return { service: new WorkspaceEditService(undoRedo, new TrashService(), NO_TRASH, buffers), undoRedo };
}

/**
 * То же, но с РАБОЧЕЙ корзиной: удаление отменяемо, а удаление несуществующего
 * ресурса — ошибка (в отличие от безвозвратного `rm --force`). Корзина уведена
 * в tmp через `XDG_DATA_HOME` (см. `beforeEach`).
 */
function makeServiceWithTrash(): { service: WorkspaceEditService; undoRedo: UndoRedoService } {
    const undoRedo = new UndoRedoService();
    const config: IConfigurationService = {
        ...NULL_CONFIGURATION_SERVICE,
        get<T>(key: string, def?: T): T | undefined {
            return key === "files.enableTrash" ? (true as unknown as T) : def;
        },
    };
    return {
        service: new WorkspaceEditService(undoRedo, new TrashService(), config, NULL_BULK_EDIT_BUFFERS),
        undoRedo,
    };
}

function write(rel: string, content: string): string {
    const full = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
}

function read(full: string): string {
    return fs.readFileSync(full, "utf8");
}

function resourceOf(full: string): string {
    return Uri.file(full).toString();
}

/** Текстовая правка ресурса в модели ядра. */
function textEdit(full: string, ...edits: ITextEdit[]): BulkEditOperation {
    return { resource: resourceOf(full), edits };
}

const replaceFirstLine = (text: string): ITextEdit => createTextEdit(createRange(0, 0, 0, 0), text);

describe("WorkspaceEditService.applyWorkspaceEdit — закрытые файлы", () => {
    it("правит файл, который не открыт ни одной вкладкой, прямо на диске", () => {
        const { service } = makeService();
        const closed = write("b.ts", "export class B {}\n");

        const applied = service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("// head\n"))], "Edit");

        expect(applied).toBe(true);
        expect(read(closed)).toBe("// head\nexport class B {}\n");
    });

    it("клампит координаты расширения к содержимому закрытого файла", () => {
        const { service } = makeService();
        const closed = write("b.ts", "one\ntwo\n");

        // Расширение про наш текст ничего не знает: позиция за концом документа
        // обязана приехать к его границе, а не уронить применение.
        service.applyWorkspaceEdit([textEdit(closed, createTextEdit(createRange(99, 99, 99, 99), "!"))], "Edit");

        expect(read(closed)).toBe("one\ntwo\n!");
    });

    it("сохраняет EOL закрытого файла (правка не переводит CRLF в LF)", () => {
        const { service } = makeService();
        const closed = write("b.ts", "one\r\ntwo\r\n");

        // Текст правки приходит в документных строках (`\n`); обратно на диск
        // документ пишется своим EOL.
        service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("zero\n"))], "Edit");

        expect(read(closed)).toBe("zero\r\none\r\ntwo\r\n");
    });

    it("правки одного ресурса из РАЗНЫХ операций складываются в исходных координатах", () => {
        const { service } = makeService();
        const closed = write("b.ts", "alpha\nbeta\n");

        const applied = service.applyWorkspaceEdit(
            [
                textEdit(closed, createTextEdit(createRange(0, 0, 0, 5), "ALPHA")),
                textEdit(closed, createTextEdit(createRange(1, 0, 1, 4), "BETA")),
            ],
            "Edit",
        );

        expect(applied).toBe(true);
        expect(read(closed)).toBe("ALPHA\nBETA\n");
    });

    it("undo возвращает закрытому файлу прежнее содержимое, redo — новое", async () => {
        const { service, undoRedo } = makeService();
        const closed = write("b.ts", "before\n");

        service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("after\n"))], "Edit");
        expect(read(closed)).toBe("after\nbefore\n");

        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(read(closed)).toBe("before\n");
        expect(await undoRedo.redo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(read(closed)).toBe("after\nbefore\n");
    });

    it("undo отказывается, если файл изменили снаружи: чужую правку не затираем", async () => {
        const { service, undoRedo } = makeService();
        const closed = write("b.ts", "before\n");
        service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("after\n"))], "Edit");

        fs.writeFileSync(closed, "written by someone else\n");

        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
        expect(read(closed)).toBe("written by someone else\n");
        // Шаг остался в стеке: он снова станет отменяемым, если содержимое вернут.
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
    });

    it("шаг истории перечисляет тронутые пути", () => {
        const { service, undoRedo } = makeService();
        const closed = write("b.ts", "before\n");

        service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("after\n"))], "Edit");

        expect(undoRedo.peekUndo(WORKSPACE_UNDO_CONTEXT)?.resources).toEqual([closed]);
    });

    it("undo отказывается (а не падает), если файл вообще удалили снаружи", async () => {
        const { service, undoRedo } = makeService();
        const closed = write("b.ts", "before\n");
        service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("after\n"))], "Edit");

        fs.rmSync(closed);

        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
        expect(fs.existsSync(closed)).toBe(false);
    });

    it("redo отказывается, если после отката файл изменили снаружи", async () => {
        const { service, undoRedo } = makeService();
        const closed = write("b.ts", "before\n");
        service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("after\n"))], "Edit");
        await undoRedo.undo(WORKSPACE_UNDO_CONTEXT);

        fs.writeFileSync(closed, "someone else\n");

        expect(await undoRedo.redo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
        expect(read(closed)).toBe("someone else\n");
    });

    it("redo отказывается (а не падает), если после отката файл удалили снаружи", async () => {
        const { service, undoRedo } = makeService();
        const closed = write("b.ts", "before\n");
        service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("after\n"))], "Edit");
        await undoRedo.undo(WORKSPACE_UNDO_CONTEXT);

        fs.rmSync(closed);

        expect(await undoRedo.redo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
        expect(fs.existsSync(closed)).toBe(false);
    });

    it("нечитаемый ресурс отбивает ВЕСЬ edit — соседний файл не тронут", () => {
        const { service, undoRedo } = makeService();
        const existing = write("a.ts", "keep\n");

        const applied = service.applyWorkspaceEdit(
            [
                textEdit(existing, replaceFirstLine("changed\n")),
                textEdit(path.join(tmpDir, "missing.ts"), replaceFirstLine("x\n")),
            ],
            "Edit",
        );

        expect(applied).toBe(false);
        expect(read(existing)).toBe("keep\n");
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });

    it("закрытый ресурс недисковой схемы отбивает edit (записать правку некуда)", () => {
        const { service } = makeService();
        const applied = service.applyWorkspaceEdit(
            [{ resource: "output:extensions", edits: [replaceFirstLine("x")] }],
            "Edit",
        );
        expect(applied).toBe(false);
    });

    it("пересекающиеся правки одного ресурса отбивают edit целиком", () => {
        const { service } = makeService();
        const a = write("a.ts", "keep\n");
        const b = write("b.ts", "0123456789\n");

        const applied = service.applyWorkspaceEdit(
            [
                textEdit(a, replaceFirstLine("changed\n")),
                textEdit(b, createTextEdit(createRange(0, 0, 0, 4), "x"), createTextEdit(createRange(0, 2, 0, 6), "y")),
            ],
            "Edit",
        );

        expect(applied).toBe(false);
        expect(read(a)).toBe("keep\n");
        expect(read(b)).toBe("0123456789\n");
    });

    it("правки встык и две вставки в одну точку пересечением не считаются", () => {
        const { service } = makeService();
        const b = write("b.ts", "0123456789\n");

        const applied = service.applyWorkspaceEdit(
            [
                textEdit(
                    b,
                    createTextEdit(createRange(0, 0, 0, 2), "x"),
                    createTextEdit(createRange(0, 2, 0, 4), "y"),
                    createTextEdit(createRange(0, 6, 0, 6), "p"),
                    createTextEdit(createRange(0, 6, 0, 6), "q"),
                ),
            ],
            "Edit",
        );

        expect(applied).toBe(true);
        expect(read(b)).toBe("xy45pq6789\n");
    });

    it("пустой список — false: вакуумный успех отвечает вызывающий", () => {
        const { service } = makeService();
        expect(service.applyWorkspaceEdit([], "Edit")).toBe(false);
    });

    it("операции без единой правки — успех без изменений (менять нечего, но и отказа нет)", () => {
        const { service, undoRedo } = makeService();
        const closed = write("b.ts", "x\n");
        expect(service.applyWorkspaceEdit([{ resource: resourceOf(closed), edits: [] }], "Edit")).toBe(true);
        expect(read(closed)).toBe("x\n");
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });
});

describe("WorkspaceEditService.applyWorkspaceEdit — открытые буферы", () => {
    it("открытый ресурс правится через буфер, а не записью на диск", () => {
        const open = new Map<string, IFakeBuffer>();
        const file = write("a.ts", "disk\n");
        const step: IUndoRedoElement = { label: "buffer", resources: [], undo: vi.fn(), redo: vi.fn() };
        open.set(resourceOf(file), { text: "buffer\n", applied: [], step });
        const { service, undoRedo } = makeService(makeBuffers(open));

        const applied = service.applyWorkspaceEdit([textEdit(file, replaceFirstLine("head\n"))], "Edit");

        expect(applied).toBe(true);
        // Диск не тронут: правка живёт в «грязном» буфере, как в VS Code.
        expect(read(file)).toBe("disk\n");
        expect(open.get(resourceOf(file))?.applied).toEqual([
            [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "head\n" }],
        ]);
        // Шаг буфера попал в бакет, который назвал доступ к буферам.
        expect(undoRedo.canUndo(`buffer:${resourceOf(file)}`)).toBe(true);
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });

    it("координаты клампятся к тексту БУФЕРА, а не файла на диске", () => {
        const open = new Map<string, IFakeBuffer>();
        const file = write("a.ts", "0123456789\n");
        open.set(resourceOf(file), { text: "ab", applied: [], step: null });
        const { service } = makeService(makeBuffers(open));

        service.applyWorkspaceEdit([textEdit(file, createTextEdit(createRange(0, 9, 0, 9), "!"))], "Edit");

        expect(open.get(resourceOf(file))?.applied[0][0].range.start).toEqual({ line: 0, character: 2 });
    });

    it("read-only ресурс отбивает edit целиком — соседний буфер не тронут", () => {
        const open = new Map<string, IFakeBuffer>();
        const a = write("a.ts", "a\n");
        const ro = write("ro.ts", "ro\n");
        open.set(resourceOf(a), { text: "a\n", applied: [], step: null });
        const { service } = makeService(makeBuffers(open, new Set([resourceOf(ro)])));

        const applied = service.applyWorkspaceEdit(
            [textEdit(a, replaceFirstLine("x")), textEdit(ro, replaceFirstLine("y"))],
            "Edit",
        );

        expect(applied).toBe(false);
        expect(open.get(resourceOf(a))?.applied).toEqual([]);
        expect(read(ro)).toBe("ro\n");
    });

    it("буфер, чьи правки ничего не изменили, не отменяет edit — шага просто нет", () => {
        const open = new Map<string, IFakeBuffer>();
        const a = write("a.ts", "a\n");
        open.set(resourceOf(a), { text: "a\n", applied: [], step: null });
        const { service, undoRedo } = makeService(makeBuffers(open));

        expect(service.applyWorkspaceEdit([textEdit(a, replaceFirstLine(""))], "Edit")).toBe(true);
        expect(undoRedo.canUndo(`buffer:${resourceOf(a)}`)).toBe(false);
    });

    it("смешанный edit: открытый буфер + закрытый файл — ОДИН шаг отмены на оба", async () => {
        const open = new Map<string, IFakeBuffer>();
        const a = write("a.ts", "disk-a\n");
        const closed = write("b.ts", "before\n");
        const undo = vi.fn();
        const redo = vi.fn();
        open.set(resourceOf(a), { text: "buf-a\n", applied: [], step: { label: "b", resources: [], undo, redo } });
        const { service, undoRedo } = makeService(makeBuffers(open));

        const applied = service.applyWorkspaceEdit(
            [textEdit(a, replaceFirstLine("head\n")), textEdit(closed, replaceFirstLine("after\n"))],
            "Refactor",
        );

        expect(applied).toBe(true);
        expect(read(closed)).toBe("after\nbefore\n");
        const context = `buffer:${resourceOf(a)}`;
        expect(undoRedo.peekUndo(context)?.label).toBe("Refactor");

        // Один Ctrl+Z откатывает и буфер, и файл на диске.
        expect(await undoRedo.undo(context)).toBe(true);
        expect(undo).toHaveBeenCalledOnce();
        expect(read(closed)).toBe("before\n");
        expect(undoRedo.canUndo(context)).toBe(false);

        expect(await undoRedo.redo(context)).toBe(true);
        expect(redo).toHaveBeenCalledOnce();
        expect(read(closed)).toBe("after\nbefore\n");
    });

    it("отказ одного участника отменяет ВЕСЬ шаг отмены, а не его часть", async () => {
        const open = new Map<string, IFakeBuffer>();
        const a = write("a.ts", "disk-a\n");
        const closed = write("b.ts", "before\n");
        const undo = vi.fn();
        // Буфер говорит «мой шаг сейчас откатить нельзя» (после edit'а в нём
        // набрали текст) — файл на диске тоже обязан остаться как есть.
        open.set(resourceOf(a), {
            text: "buf-a\n",
            applied: [],
            step: { label: "b", resources: [], canUndo: () => false, undo, redo: vi.fn() },
        });
        const { service, undoRedo } = makeService(makeBuffers(open));
        service.applyWorkspaceEdit(
            [textEdit(a, replaceFirstLine("head\n")), textEdit(closed, replaceFirstLine("after\n"))],
            "Refactor",
        );

        const context = `buffer:${resourceOf(a)}`;
        expect(await undoRedo.undo(context)).toBe(false);
        expect(undo).not.toHaveBeenCalled();
        expect(read(closed)).toBe("after\nbefore\n");
    });

    it("безымянный буфер правится без пути на диске", () => {
        const open = new Map<string, IFakeBuffer>();
        const undo = vi.fn();
        open.set("untitled:Untitled-1", {
            text: "draft\n",
            applied: [],
            step: { label: "b", resources: [], undo, redo: vi.fn() },
        });
        const { service, undoRedo } = makeService(makeBuffers(open));

        const applied = service.applyWorkspaceEdit(
            [{ resource: "untitled:Untitled-1", edits: [replaceFirstLine("head\n")] }],
            "Edit",
        );

        expect(applied).toBe(true);
        expect(open.get("untitled:Untitled-1")?.text).toBe("head\ndraft\n");
        // В шаге истории путей нет — на диске у ресурса его ещё не было.
        expect(undoRedo.peekUndo("buffer:untitled:Untitled-1")?.resources).toEqual([]);
    });

    it("шаг истории перечисляет путь буфера, у которого он есть", () => {
        const open = new Map<string, IFakeBuffer>();
        const file = write("a.ts", "disk\n");
        open.set(resourceOf(file), {
            text: "buffer\n",
            applied: [],
            step: { label: "b", resources: [], undo: vi.fn(), redo: vi.fn() },
        });
        const { service, undoRedo } = makeService(makeBuffers(open));

        service.applyWorkspaceEdit([textEdit(file, replaceFirstLine("head\n"))], "Edit");

        expect(undoRedo.peekUndo(`buffer:${resourceOf(file)}`)?.resources).toEqual([file]);
    });

    it("бакет выбирается по тронутым БУФЕРАМ — файловые операции в этот список не идут", () => {
        const open = new Map<string, IFakeBuffer>();
        const file = write("a.ts", "disk\n");
        open.set(resourceOf(file), {
            text: "buffer\n",
            applied: [],
            step: { label: "b", resources: [], undo: vi.fn(), redo: vi.fn() },
        });
        const { service, undoRedo } = makeService(makeBuffers(open));

        service.applyWorkspaceEdit(
            [
                { kind: "create", to: path.join(tmpDir, "created.ts"), contents: "x" },
                textEdit(file, replaceFirstLine("head\n")),
            ],
            "Edit",
        );

        // Двойник отдаёт бакет ПЕРВОГО тронутого ресурса: им обязан быть буфер,
        // а не путь созданного файла.
        expect(undoRedo.canUndo(`buffer:${resourceOf(file)}`)).toBe(true);
    });

    it("отказ одного участника в ПОВТОРЕ отменяет повтор всего шага", async () => {
        const open = new Map<string, IFakeBuffer>();
        const file = write("a.ts", "disk\n");
        const closed = write("b.ts", "before\n");
        const redo = vi.fn();
        open.set(resourceOf(file), {
            text: "buffer\n",
            applied: [],
            step: { label: "b", resources: [], canRedo: () => false, undo: vi.fn(), redo },
        });
        const { service, undoRedo } = makeService(makeBuffers(open));
        service.applyWorkspaceEdit(
            [textEdit(file, replaceFirstLine("head\n")), textEdit(closed, replaceFirstLine("after\n"))],
            "Refactor",
        );
        const context = `buffer:${resourceOf(file)}`;
        await undoRedo.undo(context);

        expect(await undoRedo.redo(context)).toBe(false);
        expect(redo).not.toHaveBeenCalled();
        expect(read(closed)).toBe("before\n");
    });

    it("без тронутых буферов шаг уходит в общий бакет workspace-операций", () => {
        const { service, undoRedo } = makeService(makeBuffers(new Map()));
        const closed = write("b.ts", "x\n");

        service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("y\n"))], "Edit");

        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
    });
});

describe("WorkspaceEditService.applyWorkspaceEdit — файловые операции", () => {
    it("создаёт файл и тут же пишет в него: порядок операций соблюдается", async () => {
        const { service, undoRedo } = makeService();
        const created = path.join(tmpDir, "new", "moved.ts");

        const applied = service.applyWorkspaceEdit(
            [
                { kind: "create", to: created, contents: "export const a = 1;\n" },
                { resource: resourceOf(created), edits: [replaceFirstLine("// moved\n")] },
            ],
            "Move to a new file",
        );

        expect(applied).toBe(true);
        expect(read(created)).toBe("// moved\nexport const a = 1;\n");

        // Один шаг отмены на весь edit: undo убирает и текст, и файл.
        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(fs.existsSync(created)).toBe(false);
        expect(fs.existsSync(path.join(tmpDir, "new"))).toBe(false);
    });

    it("создание БЕЗ содержимого даёт пустой файл — правка ложится в него одна", () => {
        const { service } = makeService();
        const created = path.join(tmpDir, "empty.ts");

        const applied = service.applyWorkspaceEdit(
            [
                { kind: "create", to: created },
                { resource: resourceOf(created), edits: [replaceFirstLine("hello")] },
            ],
            "Create",
        );

        expect(applied).toBe(true);
        expect(read(created)).toBe("hello");
    });

    it("переименование + правка по НОВОМУ пути в одном edit'е", () => {
        const { service } = makeService();
        const from = write("old.ts", "content\n");
        const to = path.join(tmpDir, "new.ts");

        const applied = service.applyWorkspaceEdit(
            [
                { kind: "rename", from, to },
                { resource: resourceOf(to), edits: [replaceFirstLine("// renamed\n")] },
            ],
            "Rename",
        );

        expect(applied).toBe(true);
        expect(fs.existsSync(from)).toBe(false);
        expect(read(to)).toBe("// renamed\ncontent\n");
    });

    it("файловая операция по ресурсу, который УЖЕ правится текстом, отбивает edit", () => {
        const { service } = makeService();
        const source = write("a.ts", "content\n");
        const target = path.join(tmpDir, "b.ts");

        // Порядок «сначала правки, потом перенос» мы не умеем спроецировать:
        // база правок снята со старого пути. Честный отказ вместо испорченного
        // результата.
        expect(
            service.applyWorkspaceEdit(
                [textEdit(source, replaceFirstLine("// head\n")), { kind: "rename", from: source, to: target }],
                "Edit",
            ),
        ).toBe(false);
        expect(read(source)).toBe("content\n");
        expect(fs.existsSync(target)).toBe(false);

        // Обратный порядок (файловая операция, затем правки по новому пути) —
        // работает: именно его и присылают расширения.
        expect(
            service.applyWorkspaceEdit(
                [{ kind: "rename", from: source, to: target }, textEdit(target, replaceFirstLine("// head\n"))],
                "Edit",
            ),
        ).toBe(true);
        expect(read(target)).toBe("// head\ncontent\n");
    });

    it("правка + удаление ТОГО ЖЕ ресурса в одном edit'е отбивается", () => {
        const { service } = makeService();
        const victim = write("victim.ts", "content\n");

        expect(
            service.applyWorkspaceEdit(
                [textEdit(victim, replaceFirstLine("// head\n")), { kind: "delete", from: victim }],
                "Edit",
            ),
        ).toBe(false);
        expect(read(victim)).toBe("content\n");
    });

    it("удаление + правка удалённого ресурса в одном edit'е отбивается (писать некуда)", () => {
        const { service } = makeService();
        const victim = write("victim.ts", "content\n");

        const applied = service.applyWorkspaceEdit(
            [
                { kind: "delete", from: victim },
                { resource: resourceOf(victim), edits: [replaceFirstLine("x")] },
            ],
            "Edit",
        );

        expect(applied).toBe(false);
        // Валидация идёт ДО применения: файл на месте.
        expect(read(victim)).toBe("content\n");
    });

    it("создание поверх существующего файла без опций — отказ всего edit'а", () => {
        const { service } = makeService();
        const existing = write("taken.ts", "mine\n");

        expect(service.applyWorkspaceEdit([{ kind: "create", to: existing }], "Create")).toBe(false);
        expect(read(existing)).toBe("mine\n");
    });

    it("ignoreIfExists превращает создание поверх существующего в no-op", () => {
        const { service } = makeService();
        const existing = write("taken.ts", "mine\n");

        expect(
            service.applyWorkspaceEdit(
                [
                    { kind: "create", to: existing, contents: "other", ignoreIfExists: true },
                    { kind: "create", to: path.join(tmpDir, "fresh.ts"), contents: "fresh" },
                ],
                "Create",
            ),
        ).toBe(true);
        expect(read(existing)).toBe("mine\n");
        expect(read(path.join(tmpDir, "fresh.ts"))).toBe("fresh");
    });

    it("edit из одних пропущенных операций — успех без шага отмены", () => {
        const { service, undoRedo } = makeService();
        const existing = write("taken.ts", "mine\n");

        expect(service.applyWorkspaceEdit([{ kind: "create", to: existing, ignoreIfExists: true }], "Create")).toBe(
            true,
        );
        expect(read(existing)).toBe("mine\n");
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });

    it("overwrite затирает существующий файл, undo возвращает прежнее содержимое", async () => {
        const { service, undoRedo } = makeService();
        const existing = write("taken.ts", "mine\n");

        expect(
            service.applyWorkspaceEdit(
                [{ kind: "create", to: existing, contents: "theirs", overwrite: true }],
                "Create",
            ),
        ).toBe(true);
        expect(read(existing)).toBe("theirs");

        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(read(existing)).toBe("mine\n");
    });

    it("overwrite по пути, где файла нет, просто создаёт его", async () => {
        const { service, undoRedo } = makeService();
        const fresh = path.join(tmpDir, "fresh.ts");

        expect(
            service.applyWorkspaceEdit([{ kind: "create", to: fresh, contents: "new", overwrite: true }], "Create"),
        ).toBe(true);
        expect(read(fresh)).toBe("new");

        // Возвращать на место нечего — undo просто убирает созданный файл.
        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(fs.existsSync(fresh)).toBe(false);
    });

    it("удалённый этим же edit'ом ресурс можно создать заново", () => {
        const { service } = makeService();
        const victim = write("victim.ts", "old\n");

        expect(
            service.applyWorkspaceEdit(
                [
                    { kind: "delete", from: victim },
                    { kind: "create", to: victim, contents: "new\n" },
                ],
                "Replace",
            ),
        ).toBe(true);
        expect(read(victim)).toBe("new\n");
    });

    it("overwrite бьёт ignoreIfExists (как в vscode API)", () => {
        const { service } = makeService();
        const existing = write("taken.ts", "mine\n");

        service.applyWorkspaceEdit(
            [{ kind: "create", to: existing, contents: "theirs", overwrite: true, ignoreIfExists: true }],
            "Create",
        );

        expect(read(existing)).toBe("theirs");
    });

    it("overwrite поверх файла, созданного ЭТИМ ЖЕ edit'ом (на диске его ещё нет)", () => {
        const { service } = makeService();
        const target = path.join(tmpDir, "twice.ts");

        const applied = service.applyWorkspaceEdit(
            [
                { kind: "create", to: target, contents: "first" },
                { kind: "create", to: target, contents: "second", overwrite: true },
            ],
            "Create",
        );

        expect(applied).toBe(true);
        expect(read(target)).toBe("second");
    });

    it("overwrite по каталогу отбивает edit (затирать дерево мы не будем)", () => {
        const { service } = makeService();
        const dir = path.join(tmpDir, "dir");
        fs.mkdirSync(dir);

        expect(service.applyWorkspaceEdit([{ kind: "create", to: dir, overwrite: true }], "Create")).toBe(false);
        expect(fs.existsSync(dir)).toBe(true);
    });

    it("удаление отсутствующего ресурса — отказ, а с ignoreIfNotExists — no-op", () => {
        const { service } = makeService();
        const missing = path.join(tmpDir, "ghost.ts");

        expect(service.applyWorkspaceEdit([{ kind: "delete", from: missing }], "Delete")).toBe(false);
        expect(
            service.applyWorkspaceEdit(
                [
                    { kind: "delete", from: missing, ignoreIfNotExists: true },
                    { kind: "create", to: path.join(tmpDir, "fresh.ts") },
                ],
                "Delete",
            ),
        ).toBe(true);
    });

    it("ignoreIfNotExists не мешает удалить СУЩЕСТВУЮЩИЙ ресурс", () => {
        const { service } = makeService();
        const victim = write("victim.ts", "bye\n");

        expect(service.applyWorkspaceEdit([{ kind: "delete", from: victim, ignoreIfNotExists: true }], "Delete")).toBe(
            true,
        );
        expect(fs.existsSync(victim)).toBe(false);
    });

    it("пропущенное удаление не доходит до корзины (иначе она отбила бы весь edit)", () => {
        const { service } = makeServiceWithTrash();
        const missing = path.join(tmpDir, "ghost.ts");
        const fresh = path.join(tmpDir, "fresh.ts");

        // С рабочей корзиной удаление несуществующего — ошибка, и если бы
        // операция НЕ пропускалась, edit откатился бы целиком.
        expect(
            service.applyWorkspaceEdit(
                [
                    { kind: "delete", from: missing, ignoreIfNotExists: true },
                    { kind: "create", to: fresh, contents: "x" },
                ],
                "Delete",
            ),
        ).toBe(true);
        expect(read(fresh)).toBe("x");
    });

    it("удаление в корзину отменяемо одним шагом вместе с остальным edit'ом", async () => {
        const { service, undoRedo } = makeServiceWithTrash();
        const victim = write("victim.ts", "bye\n");
        const closed = write("b.ts", "before\n");

        expect(
            service.applyWorkspaceEdit(
                [{ kind: "delete", from: victim }, textEdit(closed, replaceFirstLine("after\n"))],
                "Refactor",
            ),
        ).toBe(true);
        expect(fs.existsSync(victim)).toBe(false);

        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(read(victim)).toBe("bye\n");
        expect(read(closed)).toBe("before\n");
    });

    it("переименование отсутствующего источника отбивает edit даже с ignoreIfExists", () => {
        const { service } = makeService();
        const ghost = path.join(tmpDir, "ghost.ts");
        const taken = write("taken.ts", "mine\n");

        // `ignoreIfExists` говорит про ЦЕЛЬ; отсутствующий источник — всё равно
        // отказ, а не «молча ничего не делаем».
        expect(
            service.applyWorkspaceEdit([{ kind: "rename", from: ghost, to: taken, ignoreIfExists: true }], "Rename"),
        ).toBe(false);
        expect(read(taken)).toBe("mine\n");
    });

    it("переименование отсутствующего источника отбивает edit", () => {
        const { service } = makeService();
        expect(
            service.applyWorkspaceEdit(
                [{ kind: "rename", from: path.join(tmpDir, "ghost.ts"), to: path.join(tmpDir, "x.ts") }],
                "Rename",
            ),
        ).toBe(false);
    });

    it("переименование на занятое имя: отказ без опций, no-op с ignoreIfExists, затирание с overwrite", async () => {
        const { service, undoRedo } = makeService();
        const from = write("from.ts", "source\n");
        const to = write("to.ts", "target\n");

        expect(service.applyWorkspaceEdit([{ kind: "rename", from, to }], "Rename")).toBe(false);
        expect(read(from)).toBe("source\n");

        expect(
            service.applyWorkspaceEdit(
                [
                    { kind: "rename", from, to, ignoreIfExists: true },
                    { kind: "create", to: path.join(tmpDir, "f.ts") },
                ],
                "Rename",
            ),
        ).toBe(true);
        expect(read(from)).toBe("source\n");
        expect(read(to)).toBe("target\n");

        expect(service.applyWorkspaceEdit([{ kind: "rename", from, to, overwrite: true }], "Rename")).toBe(true);
        expect(fs.existsSync(from)).toBe(false);
        expect(read(to)).toBe("source\n");

        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(read(from)).toBe("source\n");
        expect(read(to)).toBe("target\n");
    });

    it("созданный ЭТИМ ЖЕ edit'ом файл уже «существует» для следующих операций", () => {
        const { service } = makeService();
        const fresh = path.join(tmpDir, "generated.ts");

        // Удаление видит файл, которого на диске ещё нет: его создал сам edit.
        expect(
            service.applyWorkspaceEdit(
                [
                    { kind: "create", to: fresh, contents: "temp" },
                    { kind: "delete", from: fresh },
                ],
                "Create and drop",
            ),
        ).toBe(true);
        expect(fs.existsSync(fresh)).toBe(false);
    });

    it("переименованный ЭТИМ ЖЕ edit'ом ресурс освобождает старый путь", () => {
        const { service } = makeService();
        const from = write("a.ts", "payload\n");
        const to = path.join(tmpDir, "b.ts");

        expect(
            service.applyWorkspaceEdit(
                [
                    { kind: "rename", from, to },
                    { kind: "create", to: from, contents: "fresh\n" },
                ],
                "Rename",
            ),
        ).toBe(true);
        expect(read(to)).toBe("payload\n");
        expect(read(from)).toBe("fresh\n");
    });

    it("сбой записи после валидации откатывает уже применённое и отвечает отказом", () => {
        const { service, undoRedo } = makeService();
        const closed = write("b.ts", "before\n");
        // Каталог на месте целевого файла: валидация видит «ресурса нет»
        // (`existsSync` на несуществующем вложенном пути), а запись падает.
        const blocked = path.join(tmpDir, "blocked.ts");
        fs.mkdirSync(blocked);

        const applied = service.applyWorkspaceEdit(
            [
                { resource: resourceOf(closed), edits: [replaceFirstLine("after\n")] },
                { kind: "create", to: path.join(blocked, "x", "y") },
                { kind: "rename", from: blocked, to: path.join(tmpDir, "dst", "deep", "x") },
            ],
            "Edit",
        );

        expect(applied).toBe(false);
        expect(read(closed)).toBe("before\n");
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });
});
