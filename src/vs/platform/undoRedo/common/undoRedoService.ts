import { token } from "../../instantiation/common/diContainer.ts";

import type { IUndoRedoElement } from "./iUndoRedoElement.ts";

/** Контекст файловых/workspace-операций (отмена в проводнике). */
export const WORKSPACE_UNDO_CONTEXT = "workspace";

/**
 * Единый сервис отмены/повтора уровня workspace. История разнесена по контекстным
 * бакетам: непрозрачный ключ редактора (`TextFileModel.undoContext`) либо
 * {@link WORKSPACE_UNDO_CONTEXT} (файловые операции в проводнике). Так Ctrl+Z в
 * редакторе и в дереве не мешают друг другу, но проходят через один сервис и одну
 * модель элементов.
 *
 * Ключ намеренно непрозрачен и не является путём: путь как бакет ломался на
 * безымянных буферах (все сходились в один бакет) и на `saveAs` (смена пути
 * осиротляла историю).
 */
export class UndoRedoService {
    private undoStacks = new Map<string, IUndoRedoElement[]>();
    private redoStacks = new Map<string, IUndoRedoElement[]>();

    private stack(map: Map<string, IUndoRedoElement[]>, context: string): IUndoRedoElement[] {
        let stack = map.get(context);
        if (!stack) {
            stack = [];
            map.set(context, stack);
        }
        return stack;
    }

    /** Кладёт новый шаг в стек контекста и очищает его redo. */
    public pushElement(element: IUndoRedoElement, context: string): void {
        this.stack(this.undoStacks, context).push(element);
        this.stack(this.redoStacks, context).length = 0;
    }

    public canUndo(context: string): boolean {
        return this.stack(this.undoStacks, context).length > 0;
    }

    public canRedo(context: string): boolean {
        return this.stack(this.redoStacks, context).length > 0;
    }

    /** Верхний элемент undo без снятия — для гейта подтверждения в UI. */
    public peekUndo(context: string): IUndoRedoElement | undefined {
        const stack = this.stack(this.undoStacks, context);
        return stack[stack.length - 1];
    }

    public peekRedo(context: string): IUndoRedoElement | undefined {
        const stack = this.stack(this.redoStacks, context);
        return stack[stack.length - 1];
    }

    /**
     * Откатывает верхний шаг контекста. `false` — откатывать нечего ЛИБО шаг
     * отказался (`canUndo() === false`, см. {@link IUndoRedoElement.canUndo}):
     * в отказе шаг остаётся в стеке, половинчато не применяется ничего.
     */
    public async undo(context: string): Promise<boolean> {
        const stack = this.stack(this.undoStacks, context);
        const element = stack.at(-1);
        if (!element) return false;
        if (element.canUndo?.() === false) return false;
        stack.pop();
        // Перемещаем по стекам синхронно (до await), чтобы немедленный redo сразу видел
        // элемент; синхронная часть element.undo() тоже успевает отработать до возврата.
        this.stack(this.redoStacks, context).push(element);
        await element.undo();
        return true;
    }

    /** Повторяет откаченный шаг; отказ — как в {@link undo}. */
    public async redo(context: string): Promise<boolean> {
        const stack = this.stack(this.redoStacks, context);
        const element = stack.at(-1);
        if (!element) return false;
        if (element.canRedo?.() === false) return false;
        stack.pop();
        this.stack(this.undoStacks, context).push(element);
        await element.redo();
        return true;
    }

    /** Сбрасывает историю контекста (например, при закрытии редактора). */
    public clear(context: string): void {
        this.stack(this.undoStacks, context).length = 0;
        this.stack(this.redoStacks, context).length = 0;
    }
}

export const UndoRedoServiceDIToken = token<UndoRedoService>("UndoRedoService");
