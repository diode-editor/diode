import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { UndoRedoService, WORKSPACE_UNDO_CONTEXT } from "../../../../platform/undoRedo/common/undoRedoService.ts";

// `applyExternalEditsDetached` — шов bulk edit'а: правка ложится в историю
// ДОКУМЕНТА как обычно, но шаг общей истории забирает вызывающий, чтобы собрать
// ОДИН шаг на весь `workspace.applyEdit`.

let tmpDir: string;
let ws: ITempWorkspace;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-detached-undo-" });
    tmpDir = ws.dir;
});

afterEach(() => {
    ws.dispose();
});

function openPane(undoRedo: UndoRedoService, name: string, content: string): TextEditorPane {
    const pane = createEditorPane({ undoRedoService: undoRedo });
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, content);
    pane.openFile(Uri.file(file));
    return pane;
}

const insertHead = (text: string): ReturnType<typeof createTextEdit> => createTextEdit(createRange(0, 0, 0, 0), text);

/** Шпион-поверхность: считает `markDirty`, которым модель вещает «буфер изменился». */
function spyEditTarget(pane: TextEditorPane): { markDirtyCalls: () => number } {
    let calls = 0;
    pane.model.attachEditTarget({
        cloneSelections: () => [],
        applyEdits: () => undefined,
        markDirty: () => {
            calls += 1;
        },
    });
    return { markDirtyCalls: () => calls };
}

describe("TextFileModel.applyExternalEditsDetached", () => {
    it("правка применяется, но шаг НЕ попадает в бакет документа — его отдали вызывающему", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");

        const step = pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit");

        expect(pane.getText()).toBe("head\nbody");
        expect(step).not.toBeNull();
        expect(undoRedo.canUndo(pane.undoContext)).toBe(false);
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
        expect(step?.label).toBe("Workspace Edit");
    });

    it("отданный шаг откатывает и повторяет правку документа", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");
        const step = pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit")!;

        void step.undo();
        expect(pane.getText()).toBe("body");
        void step.redo();
        expect(pane.getText()).toBe("head\nbody");
    });

    it("шаг отказывается от отката, если после него в документе набрали текст", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");
        const step = pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit")!;

        pane.pushUndo(pane.viewState.type("typed"));

        // Сверху лежит набор текста: откат снял бы не нашу правку.
        expect(step.canUndo?.()).toBe(false);
        // Своя история документа при этом работает как обычно.
        pane.undo();
        expect(pane.getText()).toBe("head\nbody");
        // И наш шаг снова отменяем.
        expect(step.canUndo?.()).toBe(true);
    });

    it("шаг истории называет путь документа, которого касается", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");
        const step = pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit")!;

        expect(step.resources).toEqual([pane.absoluteFilePath]);
    });

    it("у безымянного буфера шаг путей не называет — на диске его ещё нет", () => {
        const pane = createEditorPane({ undoRedoService: new UndoRedoService() });
        const step = pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit")!;

        expect(pane.absoluteFilePath).toBeNull();
        expect(step.resources).toEqual([]);
    });

    it("применение и откат вещают «буфер изменился» всем прикреплённым вью", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");
        const spy = spyEditTarget(pane);

        const step = pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit")!;
        const afterApply = spy.markDirtyCalls();
        expect(afterApply).toBeGreaterThan(0);

        void step.undo();
        const afterUndo = spy.markDirtyCalls();
        expect(afterUndo).toBeGreaterThan(afterApply);

        void step.redo();
        expect(spy.markDirtyCalls()).toBeGreaterThan(afterUndo);
    });

    it("без явной цели правка идёт в ПЕРВУЮ прикреплённую вью, а не в никуда", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");

        // Программный путь (bulk edit) действующей вью не знает — цель берётся
        // из прикреплённых.
        const step = pane.model.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit");

        expect(step).not.toBeNull();
        expect(pane.getText()).toBe("head\nbody");
    });

    it("шаг отказывается от повтора, если после отката в документе набрали текст", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");
        const step = pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit")!;
        void step.undo();
        expect(step.canRedo?.()).toBe(true);

        // Набор текста чистит стек повтора: наш шаг там больше не верхний.
        pane.pushUndo(pane.viewState.type("typed"));

        expect(step.canRedo?.()).toBe(false);
    });

    it("шаг отказывается от повтора, пока его не откатили", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");
        const step = pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit")!;

        expect(step.canRedo?.()).toBe(false);
        void step.undo();
        expect(step.canRedo?.()).toBe(true);
    });

    it("шаги ДВУХ документов складываются в один набор и откатываются вместе", () => {
        const undoRedo = new UndoRedoService();
        const a = openPane(undoRedo, "a.txt", "alpha");
        const b = openPane(undoRedo, "b.txt", "beta");

        const steps = [
            a.applyExternalEditsDetached([insertHead("A")], "Refactor")!,
            b.applyExternalEditsDetached([insertHead("B")], "Refactor")!,
        ];
        expect(a.getText()).toBe("Aalpha");
        expect(b.getText()).toBe("Bbeta");

        // Вызывающий кладёт ОДИН элемент на оба документа.
        undoRedo.pushElement(
            {
                label: "Refactor",
                resources: [],
                canUndo: () => steps.every((s) => s.canUndo?.() !== false),
                undo: () => {
                    for (const s of [...steps].reverse()) void s.undo();
                },
                redo: () => {
                    for (const s of steps) void s.redo();
                },
            },
            a.undoContext,
        );

        void undoRedo.undo(a.undoContext);
        expect(a.getText()).toBe("alpha");
        expect(b.getText()).toBe("beta");
    });

    it("применять нечего (пустой батч) — null, а не выдуманный шаг", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");
        expect(pane.applyExternalEditsDetached([], "Workspace Edit")).toBeNull();
        expect(pane.getText()).toBe("body");
    });

    it("шаг модели БЕЗ прикреплённой вью не выдумывается — null (правку проводить нечем)", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");
        const model = pane.model;
        // Вью отцепилась раньше модели (закрытие сплита) — цели для правки нет.
        pane.component.dispose();
        expect(model.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit")).toBeNull();
        expect(model.getText()).toBe("body");
    });

    it("обычный applyExternalEdits после detached снова кладёт шаг в бакет документа", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");

        pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit");
        pane.applyExternalEdits([insertHead("top\n")], "Trim");

        expect(undoRedo.canUndo(pane.undoContext)).toBe(true);
        expect(undoRedo.peekUndo(pane.undoContext)?.label).toBe("Trim");
    });
});
