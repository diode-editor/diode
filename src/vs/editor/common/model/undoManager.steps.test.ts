import { describe, expect, it } from "vitest";

import { createRange } from "../core/iRange.ts";
import { createTextEdit } from "../core/iTextEdit.ts";

import { TextDocument } from "./textDocument.ts";
import { UndoManager } from "./undoManager.ts";

// Токены шагов: ими владелец (bulk edit, собирающий ОДИН шаг на несколько
// документов) отвечает на вопрос «снимет ли следующий undo ИМЕННО мой шаг».
// Версия документа для этого не годится — `undo` переписывает `versionAfter`
// следующего элемента стека, и снятый снаружи снимок устаревает.

/** Вставка `text` в начало документа — один шаг истории. */
function push(manager: UndoManager, doc: TextDocument, label: string, text: string): void {
    const version = doc.versionId;
    const { appliedVersion, inverseEdits } = doc.applyEdits([createTextEdit(createRange(0, 0, 0, 0), text)]);
    manager.pushUndoElement({
        label,
        versionBefore: version,
        versionAfter: appliedVersion,
        forwardEdits: [createTextEdit(createRange(0, 0, 0, 0), text)],
        backwardEdits: inverseEdits,
        beforeSelections: [],
        afterSelections: [],
    });
}

describe("UndoManager — токены шагов", () => {
    it("пустые стеки токенов не отдают", () => {
        const manager = new UndoManager(new TextDocument(""));
        expect(manager.peekUndoStep()).toBeUndefined();
        expect(manager.peekRedoStep()).toBeUndefined();
    });

    it("свежий шаг — верхний и отменяемый", () => {
        const doc = new TextDocument("");
        const manager = new UndoManager(doc);
        push(manager, doc, "first", "a");
        const step = manager.peekUndoStep();

        expect(step).toBeDefined();
        expect(manager.canUndoStep(step!)).toBe(true);
    });

    it("шаг, накрытый следующим, перестаёт быть отменяемым — и снова становится после undo", () => {
        const doc = new TextDocument("");
        const manager = new UndoManager(doc);
        push(manager, doc, "first", "a");
        const first = manager.peekUndoStep()!;
        push(manager, doc, "second", "b");

        // Сверху лежит `second`: следующий undo снимет не наш шаг.
        expect(manager.canUndoStep(first)).toBe(false);
        expect(manager.canUndoStep(manager.peekUndoStep()!)).toBe(true);

        manager.undo();
        // Версия документа при этом ушла вперёд (undo — тоже правка), но
        // менеджер подновил `versionAfter` нашего шага: он снова отменяем.
        expect(manager.canUndoStep(first)).toBe(true);
    });

    it("правка документа МИМО менеджера снимает отменяемость верхнего шага", () => {
        const doc = new TextDocument("");
        const manager = new UndoManager(doc);
        push(manager, doc, "first", "a");
        const step = manager.peekUndoStep()!;

        doc.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "mimo")]);

        expect(manager.canUndoStep(step)).toBe(false);
        // И сам `undo` отказывается — токен не обещает больше, чем менеджер.
        expect(manager.undo()).toBe(false);
    });

    it("после отмены шаг переезжает в стек повтора НОВЫМ токеном", () => {
        const doc = new TextDocument("");
        const manager = new UndoManager(doc);
        push(manager, doc, "first", "a");
        const undoToken = manager.peekUndoStep()!;
        manager.undo();

        const redoToken = manager.peekRedoStep();
        expect(redoToken).toBeDefined();
        expect(redoToken).not.toBe(undoToken);
        expect(manager.canRedoStep(redoToken!)).toBe(true);
        // Старый токен повтору не принадлежит.
        expect(manager.canRedoStep(undoToken)).toBe(false);
    });

    it("шаг повтора, накрытый следующим, повторяемым не считается", () => {
        const doc = new TextDocument("");
        const manager = new UndoManager(doc);
        push(manager, doc, "first", "a");
        push(manager, doc, "second", "b");
        manager.undo();
        const second = manager.peekRedoStep()!;
        manager.undo();

        expect(manager.canRedoStep(second)).toBe(false);
        expect(manager.canRedoStep(manager.peekRedoStep()!)).toBe(true);
    });
});
