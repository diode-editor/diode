import { describe, expect, it, vi } from "vitest";

import type { IUndoRedoElement } from "./iUndoRedoElement.ts";
import {
    type IUndoParticipant,
    type IUndoRefusal,
    UndoRedoService,
    WORKSPACE_UNDO_CONTEXT,
} from "./undoRedoService.ts";

function step(label: string, resources: readonly string[] = []) {
    const undo = vi.fn();
    const redo = vi.fn();
    const element: IUndoRedoElement = { label, resources, undo, redo };
    return { element, undo, redo };
}

const A: IUndoParticipant = { context: "a", label: "a.ts", owner: true };
const B: IUndoParticipant = { context: "b", label: "b.ts", owner: true };
const ANCHOR_B: IUndoParticipant = { context: "b", label: "b.ts", owner: false };

function serviceWithRefusals(): { service: UndoRedoService; refusals: IUndoRefusal[] } {
    const service = new UndoRedoService();
    const refusals: IUndoRefusal[] = [];
    service.onDidRefuse((refusal) => refusals.push(refusal));
    return { service, refusals };
}

describe("UndoRedoService — шаг нескольких документов", () => {
    it("Ctrl+Z из любого бакета откатывает шаг целиком, повтор — из любого другого", async () => {
        const { service, refusals } = serviceWithRefusals();
        const { element, undo, redo } = step("Move to a new file");
        service.pushWorkspaceElement(element, [A, B]);

        expect(service.peekUndo("a")).toBe(element);
        expect(service.peekUndo("b")).toBe(element);

        expect(await service.undo("b")).toBe(true);
        expect(undo).toHaveBeenCalledOnce();
        expect(service.canUndo("a")).toBe(false);
        expect(service.canUndo("b")).toBe(false);
        expect(service.peekRedo("a")).toBe(element);
        expect(service.peekRedo("b")).toBe(element);

        expect(await service.redo("a")).toBe(true);
        expect(redo).toHaveBeenCalledOnce();
        expect(service.peekUndo("a")).toBe(element);
        expect(service.peekUndo("b")).toBe(element);
        expect(service.canRedo("a") || service.canRedo("b")).toBe(false);
        expect(refusals).toEqual([]);
    });

    it("без участников шаг уходит в бакет workspace-операций", async () => {
        const service = new UndoRedoService();
        const { element, undo } = step("Edit");
        service.pushWorkspaceElement(element, []);

        expect(service.peekUndo(WORKSPACE_UNDO_CONTEXT)).toBe(element);
        expect(await service.undo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(undo).toHaveBeenCalledOnce();
    });

    it("правили после шага — отказ с именами файлов (строка эталона), история цела", async () => {
        const { service, refusals } = serviceWithRefusals();
        const { element, undo } = step("Move to a new file");
        service.pushWorkspaceElement(element, [A, B, { context: "c", label: "c.ts", owner: true }]);
        const typingB = step("Typing").element;
        const typingC = step("Typing").element;
        service.pushElement(typingB, "b");
        service.pushElement(typingC, "c");

        expect(await service.undo("a")).toBe(false);

        expect(undo).not.toHaveBeenCalled();
        expect(refusals).toEqual([
            {
                element,
                message: "Could not undo 'Move to a new file' across all files because changes were made to b.ts, c.ts",
            },
        ]);
        expect(service.peekUndo("a")).toBe(element);
        expect(service.peekUndo("b")).toBe(typingB);
    });

    it("повтор, когда в другом бакете уже новая правка, — отказ «Could not redo»", async () => {
        const { service, refusals } = serviceWithRefusals();
        const { element, redo } = step("Rename");
        service.pushWorkspaceElement(element, [A, B]);
        await service.undo("a");

        const other = step("Other");
        service.pushWorkspaceElement(other.element, [{ context: "c", label: "c.ts", owner: true }, A]);
        // pushElement into `a` truncated the step's redo in ALL buckets: nothing to redo.
        expect(await service.redo("b")).toBe(false);
        expect(redo).not.toHaveBeenCalled();
        expect(refusals).toEqual([]);

        // A real redo refusal: the step is in both redo stacks but not on top in one.
        const third = step("Third");
        service.pushWorkspaceElement(third.element, [A, B]);
        await service.undo("a");
        const blocker = step("Blocker").element;
        (service as unknown as { redoStacks: Map<string, IUndoRedoElement[]> }).redoStacks.get("b")?.push(blocker);
        expect(await service.redo("a")).toBe(false);
        expect(refusals.at(-1)?.message).toBe(
            "Could not redo 'Third' across all files because changes were made to b.ts",
        );
    });

    it("отказ самого шага (canUndo: false) — молча, без сообщения", async () => {
        const { service, refusals } = serviceWithRefusals();
        const element: IUndoRedoElement = { ...step("Edit").element, canUndo: () => false };
        service.pushWorkspaceElement(element, [A, B]);

        expect(await service.undo("a")).toBe(false);
        expect(refusals).toEqual([]);
        expect(service.peekUndo("b")).toBe(element);
    });

    it("асинхронный canUndo: пока ждали диск, в другом бакете появилась правка — шаг не снимается", async () => {
        const service = new UndoRedoService();
        let answer = (_can: boolean): void => {};
        const undo = vi.fn();
        const element: IUndoRedoElement = {
            label: "Edit",
            resources: [],
            undo,
            redo: vi.fn(),
            canUndo: () => new Promise<boolean>((resolve) => (answer = resolve)),
        };
        service.pushWorkspaceElement(element, [A, B]);

        const pending = service.undo("a");
        service.pushElement(step("Typing").element, "b");
        answer(true);

        expect(await pending).toBe(false);
        expect(undo).not.toHaveBeenCalled();
        expect(service.peekUndo("a")).toBe(element);
    });

    it("асинхронный canRedo: то же для повтора", async () => {
        const service = new UndoRedoService();
        let answer = (_can: boolean): void => {};
        const redo = vi.fn();
        const element: IUndoRedoElement = {
            label: "Edit",
            resources: [],
            undo: vi.fn(),
            redo,
            canRedo: () => new Promise<boolean>((resolve) => (answer = resolve)),
        };
        service.pushWorkspaceElement(element, [A, B]);
        await service.undo("a");

        const pending = service.redo("b");
        (service as unknown as { redoStacks: Map<string, IUndoRedoElement[]> }).redoStacks
            .get("a")
            ?.push(step("Blocker").element);
        answer(true);

        expect(await pending).toBe(false);
        expect(redo).not.toHaveBeenCalled();
    });

    it("закрыли бакет без своей правки — он просто уходит из участников", async () => {
        const { service, refusals } = serviceWithRefusals();
        const { element, undo } = step("Move to a new file");
        service.pushWorkspaceElement(element, [A, ANCHOR_B]);

        service.clear("b");

        expect(await service.undo("a")).toBe(true);
        expect(undo).toHaveBeenCalledOnce();
        expect(refusals).toEqual([]);
        expect(service.canRedo("b")).toBe(false);
        expect(service.peekRedo("a")).toBe(element);
    });

    it("закрыли бакет СО своей правкой — отмена сбрасывает историю участников (как эталон)", async () => {
        const { service, refusals } = serviceWithRefusals();
        const { element, undo } = step("Move to a new file");
        const older = step("Typing").element;
        service.pushElement(older, "a");
        service.pushWorkspaceElement(element, [A, B]);

        service.clear("b");

        expect(await service.undo("a")).toBe(false);
        expect(undo).not.toHaveBeenCalled();
        expect(refusals).toEqual([
            {
                element,
                message:
                    "Could not undo 'Move to a new file' across all files. The following files have been closed and modified on disk: b.ts.",
            },
        ]);
        // The step is never split: the participant's history is cleared entirely, no repeated refusals.
        expect(service.canUndo("a")).toBe(false);
        expect(await service.undo("a")).toBe(false);
        expect(refusals).toHaveLength(1);
    });

    it("буфер перечитан с диска — другое пояснение; обе причины — двумя строками", async () => {
        const { service, refusals } = serviceWithRefusals();
        const replaced = step("Rename").element;
        service.pushWorkspaceElement(replaced, [A, B]);
        service.clear("b", "replaced");
        await service.undo("a");
        expect(refusals.at(-1)?.message).toBe(
            "Could not undo 'Rename' across all files. The following files have been modified in an incompatible way: b.ts.",
        );

        const both = step("Both").element;
        const c: IUndoParticipant = { context: "c", label: "c.ts", owner: true };
        service.pushWorkspaceElement(both, [A, B, c]);
        service.clear("b", "closed");
        service.clear("c", "replaced");
        await service.undo("a");
        expect(refusals.at(-1)?.message).toBe(
            "Could not undo 'Both' across all files. The following files have been closed and modified on disk: b.ts.\n" +
                "The following files have been modified in an incompatible way: c.ts.",
        );
    });

    it("несколько потерянных файлов одной причины — через запятую", async () => {
        const { service, refusals } = serviceWithRefusals();
        const c: IUndoParticipant = { context: "c", label: "c.ts", owner: true };
        const d: IUndoParticipant = { context: "d", label: "d.ts", owner: true };
        const e: IUndoParticipant = { context: "e", label: "e.ts", owner: true };
        service.pushWorkspaceElement(step("Many").element, [A, B, c, d, e]);
        service.clear("b");
        service.clear("c");
        service.clear("d", "replaced");
        service.clear("e", "replaced");

        await service.undo("a");

        expect(refusals.at(-1)?.message).toBe(
            "Could not undo 'Many' across all files. The following files have been closed and modified on disk: b.ts, c.ts.\n" +
                "The following files have been modified in an incompatible way: d.ts, e.ts.",
        );
    });

    it("сломанный шаг на повторе — «Could not redo», redo участников сброшен", async () => {
        const { service, refusals } = serviceWithRefusals();
        const { element } = step("Rename");
        service.pushWorkspaceElement(element, [A, B]);
        await service.undo("a");
        // Break the step without removing it from redo: the same loss mark as on the undo stack.
        (
            service as unknown as { workspaceElements: WeakMap<IUndoRedoElement, { removed: Map<string, string> }> }
        ).workspaceElements
            .get(element)
            ?.removed.set("b.ts", "closed");

        expect(await service.redo("a")).toBe(false);
        expect(refusals.at(-1)?.message).toBe(
            "Could not redo 'Rename' across all files. The following files have been closed and modified on disk: b.ts.",
        );
        expect(service.canRedo("a") || service.canRedo("b")).toBe(false);
    });

    it("бакет со своей правкой закрыт, пока шаг в redo, — повторять некуда: шаг уходит из redo всех", async () => {
        const service = new UndoRedoService();
        const { element, redo } = step("Rename");
        service.pushWorkspaceElement(element, [A, B]);
        await service.undo("a");

        service.clear("b");

        expect(service.canRedo("a")).toBe(false);
        expect(await service.redo("a")).toBe(false);
        expect(redo).not.toHaveBeenCalled();
    });

    it("бакет без своей правки закрыт, пока шаг в redo, — повтор из остальных работает", async () => {
        const service = new UndoRedoService();
        const { element, redo } = step("Move");
        service.pushWorkspaceElement(element, [A, ANCHOR_B]);
        await service.undo("a");

        service.clear("b", "replaced");

        expect(await service.redo("a")).toBe(true);
        expect(redo).toHaveBeenCalledOnce();
        expect(service.canUndo("b")).toBe(false);
    });

    it("новая правка в одном бакете обрезает redo шага во всех", async () => {
        const service = new UndoRedoService();
        const { element } = step("Move");
        service.pushWorkspaceElement(element, [A, B]);
        await service.undo("a");

        service.pushElement(step("Typing").element, "b");

        expect(service.canRedo("a")).toBe(false);
        expect(service.canRedo("b")).toBe(false);
    });

    it("файл, открытый после шага, принимает его в свою историю — в порядке кладки", async () => {
        const service = new UndoRedoService();
        const first = step("Move to a new file", ["/p/a.ts", "/p/Foo.ts"]);
        const second = step("Rename", ["/p/Foo.ts", "/p/x.ts"]);
        const foreign = step("Other", ["/p/a.ts"]);
        const plain = step("Typing", ["/p/Foo.ts"]);
        // Bucket b was created before bucket a: iterating buckets would give the reverse order.
        service.canUndo("b");
        service.pushWorkspaceElement(first.element, [A]);
        service.pushWorkspaceElement(foreign.element, [A]);
        service.pushWorkspaceElement(second.element, [B]);
        service.pushElement(plain.element, "x");

        service.adopt("foo", "/p/Foo.ts", "Foo.ts");

        const stack = (service as unknown as { undoStacks: Map<string, IUndoRedoElement[]> }).undoStacks.get("foo");
        expect(stack).toEqual([first.element, second.element]);

        expect(await service.undo("foo")).toBe(true);
        expect(second.undo).toHaveBeenCalledOnce();
        // An adopted bucket is a participant without its own edit: closing it doesn't break the step.
        service.clear("foo");
        expect(await service.undo("a")).toBe(true);
        expect(foreign.undo).toHaveBeenCalledOnce();
        expect(await service.undo("a")).toBe(true);
        expect(first.undo).toHaveBeenCalledOnce();
    });

    it("сброс бакета с обычными шагами в undo и redo — шаги просто уходят", async () => {
        const service = new UndoRedoService();
        service.pushElement(step("One").element, "a");
        service.pushElement(step("Two").element, "a");
        await service.undo("a");

        service.clear("a", "replaced");

        expect(service.canUndo("a")).toBe(false);
        expect(service.canRedo("a")).toBe(false);
    });

    it("сломанный шаг и шаг, где бакет уже участник, повторно не принимаются", () => {
        const service = new UndoRedoService();
        const broken = step("Broken", ["/p/Foo.ts"]);
        const own = step("Own", ["/p/Foo.ts"]);
        service.pushWorkspaceElement(broken.element, [A, B]);
        service.clear("b");
        service.pushWorkspaceElement(own.element, [{ context: "foo", label: "Foo.ts", owner: true }]);

        service.adopt("foo", "/p/Foo.ts", "Foo.ts");

        expect(service.peekUndo("foo")).toBe(own.element);
        const stack = (service as unknown as { undoStacks: Map<string, IUndoRedoElement[]> }).undoStacks.get("foo");
        expect(stack).toEqual([own.element]);
    });
});
