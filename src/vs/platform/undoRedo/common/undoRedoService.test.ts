import { describe, expect, it, vi } from "vitest";

import type { IUndoRedoElement } from "./iUndoRedoElement.ts";
import { UndoRedoService, WORKSPACE_UNDO_CONTEXT } from "./undoRedoService.ts";

function makeElement(label: string): {
    el: IUndoRedoElement;
    undo: ReturnType<typeof vi.fn>;
    redo: ReturnType<typeof vi.fn>;
} {
    const undo = vi.fn();
    const redo = vi.fn();
    return { el: { label, resources: [], undo, redo }, undo, redo };
}

const CTX = WORKSPACE_UNDO_CONTEXT;

describe("UndoRedoService", () => {
    it("starts empty", () => {
        const service = new UndoRedoService();
        expect(service.canUndo(CTX)).toBe(false);
        expect(service.canRedo(CTX)).toBe(false);
        expect(service.peekUndo(CTX)).toBeUndefined();
        expect(service.peekRedo(CTX)).toBeUndefined();
    });

    it("peekRedo exposes the top redo element without removing it", async () => {
        const service = new UndoRedoService();
        const { el } = makeElement("Move");
        service.pushElement(el, CTX);
        await service.undo(CTX);

        expect(service.peekRedo(CTX)).toBe(el);
        expect(service.canRedo(CTX)).toBe(true); // peek doesn't pop the element
    });

    it("undo calls element.undo and moves it to the redo stack", async () => {
        const service = new UndoRedoService();
        const { el, undo } = makeElement("Delete");
        service.pushElement(el, CTX);

        expect(service.canUndo(CTX)).toBe(true);
        expect(await service.undo(CTX)).toBe(true);
        expect(undo).toHaveBeenCalledOnce();
        expect(service.canUndo(CTX)).toBe(false);
        expect(service.canRedo(CTX)).toBe(true);
    });

    it("redo calls element.redo and moves it back to undo", async () => {
        const service = new UndoRedoService();
        const { el, redo } = makeElement("Move");
        service.pushElement(el, CTX);
        await service.undo(CTX);

        expect(await service.redo(CTX)).toBe(true);
        expect(redo).toHaveBeenCalledOnce();
        expect(service.canUndo(CTX)).toBe(true);
        expect(service.canRedo(CTX)).toBe(false);
    });

    it("pushing a new element clears the redo stack", async () => {
        const service = new UndoRedoService();
        service.pushElement(makeElement("a").el, CTX);
        await service.undo(CTX);
        expect(service.canRedo(CTX)).toBe(true);

        service.pushElement(makeElement("b").el, CTX);
        expect(service.canRedo(CTX)).toBe(false);
    });

    it("keeps separate stacks per context", async () => {
        const service = new UndoRedoService();
        const fileEl = makeElement("file");
        const editorEl = makeElement("editor");
        service.pushElement(fileEl.el, CTX);
        service.pushElement(editorEl.el, "/path/to/file.ts");

        await service.undo(CTX);
        expect(fileEl.undo).toHaveBeenCalledOnce();
        expect(editorEl.undo).not.toHaveBeenCalled();
        expect(service.canUndo("/path/to/file.ts")).toBe(true);
    });

    it("undo/redo on an empty context returns false", async () => {
        const service = new UndoRedoService();
        expect(await service.undo(CTX)).toBe(false);
        expect(await service.redo(CTX)).toBe(false);
    });

    it("peekUndo exposes the top element without removing it", () => {
        const service = new UndoRedoService();
        const { el } = makeElement("Paste");
        service.pushElement(el, CTX);
        expect(service.peekUndo(CTX)).toBe(el);
        expect(service.canUndo(CTX)).toBe(true);
    });

    it("clear empties both stacks of a context", async () => {
        const service = new UndoRedoService();
        service.pushElement(makeElement("a").el, CTX);
        await service.undo(CTX);
        service.clear(CTX);
        expect(service.canUndo(CTX)).toBe(false);
        expect(service.canRedo(CTX)).toBe(false);
    });
});

describe("UndoRedoService — element refusal", () => {
    it("canUndo() === false: the element is not run and STAYS on the undo stack", async () => {
        const service = new UndoRedoService();
        const { el, undo } = makeElement("Refactor");
        let allowed = false;
        service.pushElement({ ...el, canUndo: () => allowed }, CTX);

        expect(await service.undo(CTX)).toBe(false);
        expect(undo).not.toHaveBeenCalled();
        expect(service.canUndo(CTX)).toBe(true);
        expect(service.canRedo(CTX)).toBe(false);

        allowed = true;
        expect(await service.undo(CTX)).toBe(true);
        expect(undo).toHaveBeenCalledOnce();
    });

    it("canRedo() === false: the element is not run and STAYS on the redo stack", async () => {
        const service = new UndoRedoService();
        const { el, redo } = makeElement("Refactor");
        service.pushElement({ ...el, canRedo: () => false }, CTX);
        await service.undo(CTX);

        expect(await service.redo(CTX)).toBe(false);
        expect(redo).not.toHaveBeenCalled();
        expect(service.canRedo(CTX)).toBe(true);
        expect(service.canUndo(CTX)).toBe(false);
    });

    it("an element without canUndo/canRedo is always undone and redone (a plain document element)", async () => {
        const service = new UndoRedoService();
        const { el, undo, redo } = makeElement("Typing");
        service.pushElement(el, CTX);

        expect(await service.undo(CTX)).toBe(true);
        expect(await service.redo(CTX)).toBe(true);
        expect(undo).toHaveBeenCalledOnce();
        expect(redo).toHaveBeenCalledOnce();
    });

    it("a refusing element blocks the elements BELOW it — otherwise they would apply out of order", async () => {
        const service = new UndoRedoService();
        const older = makeElement("older");
        const blocking = makeElement("blocking");
        service.pushElement(older.el, CTX);
        service.pushElement({ ...blocking.el, canUndo: () => false }, CTX);

        expect(await service.undo(CTX)).toBe(false);
        expect(older.undo).not.toHaveBeenCalled();
    });

    it("async canUndo answer: a new element landed on top while this one checked the disk — neither is touched", async () => {
        const service = new UndoRedoService();
        const asking = makeElement("Edit");
        let answer!: (can: boolean) => void;
        asking.el.canUndo = () => new Promise<boolean>((resolve) => (answer = resolve));
        service.pushElement(asking.el, CTX);

        const pending = service.undo(CTX);
        const newer = makeElement("Move");
        service.pushElement(newer.el, CTX);
        answer(true);

        expect(await pending).toBe(false);
        expect(asking.undo).not.toHaveBeenCalled();
        expect(newer.undo).not.toHaveBeenCalled();
        expect(service.peekUndo(CTX)).toBe(newer.el);
    });

    it("async canRedo answer: the redo stack moved — the element is not redone", async () => {
        const service = new UndoRedoService();
        const asking = makeElement("Edit");
        let answer!: (can: boolean) => void;
        asking.el.canRedo = () => new Promise<boolean>((resolve) => (answer = resolve));
        service.pushElement(asking.el, CTX);
        await service.undo(CTX);

        const pending = service.redo(CTX);
        const other = makeElement("Move");
        service.pushElement(other.el, CTX);
        await service.undo(CTX); // `other` goes onto the redo stack on top of `asking`
        answer(true);

        expect(await pending).toBe(false);
        expect(asking.redo).not.toHaveBeenCalled();
    });

    it("async canUndo answer: allowed — the element is undone", async () => {
        const service = new UndoRedoService();
        const asking = makeElement("Edit");
        asking.el.canUndo = () => Promise.resolve(true);
        service.pushElement(asking.el, CTX);

        expect(await service.undo(CTX)).toBe(true);
        expect(asking.undo).toHaveBeenCalledOnce();
    });
});
