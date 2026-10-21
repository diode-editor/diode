import { Emitter, type Event } from "../../../base/common/event.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import type { IUndoRedoElement } from "./iUndoRedoElement.ts";

export const WORKSPACE_UNDO_CONTEXT = "workspace";

export interface IUndoParticipant {
    readonly context: string;
    readonly label: string;
    /** Шаг несёт правку буфера этого бакета: потеря такого бакета ломает шаг, бакета без правки — нет. */
    readonly owner: boolean;
}

export type UndoClearReason = "closed" | "replaced";

export interface IUndoRefusal {
    readonly element: IUndoRedoElement;
    readonly message: string;
}

interface WorkspaceElementState {
    /** Порядок кладки — по нему шаги встают в бакет открытого позже файла. */
    readonly order: number;
    readonly participants: Map<string, IUndoParticipant>;
    /** Потерянные бакеты с правкой шага; непуст — шаг сломан. */
    readonly removed: Map<string, UndoClearReason>;
}

/**
 * История разнесена по бакетам: непрозрачный ключ редактора (`TextFileModel.undoContext`)
 * либо {@link WORKSPACE_UNDO_CONTEXT}. Ключ — не путь: путь ломался на безымянных буферах
 * (сходились в один бакет) и на `saveAs` (история сиротела).
 *
 * Шаг нескольких документов лежит в бакетах всех участников, как workspace-элемент эталона,
 * и откатывается, только когда он верхний во всех. Отступление от эталона (решение
 * человека): шаг не разбивается по файлам — нет «Undo in N Files / Undo this File».
 */
export class UndoRedoService {
    private undoStacks = new Map<string, IUndoRedoElement[]>();
    private redoStacks = new Map<string, IUndoRedoElement[]>();
    private readonly workspaceElements = new WeakMap<IUndoRedoElement, WorkspaceElementState>();
    private nextOrder = 0;

    private readonly onDidRefuseEmitter = new Emitter<IUndoRefusal>();
    public readonly onDidRefuse: Event<IUndoRefusal> = this.onDidRefuseEmitter.event;

    private stack(map: Map<string, IUndoRedoElement[]>, context: string): IUndoRedoElement[] {
        let stack = map.get(context);
        if (!stack) {
            stack = [];
            map.set(context, stack);
        }
        return stack;
    }

    public pushElement(element: IUndoRedoElement, context: string): void {
        this.stack(this.undoStacks, context).push(element);
        this.truncateRedo(context);
    }

    /** Без участников шаг уходит в бакет {@link WORKSPACE_UNDO_CONTEXT}. */
    public pushWorkspaceElement(element: IUndoRedoElement, participants: readonly IUndoParticipant[]): void {
        if (participants.length === 0) {
            this.pushElement(element, WORKSPACE_UNDO_CONTEXT);
            return;
        }
        this.workspaceElements.set(element, {
            order: this.nextOrder++,
            participants: new Map(participants.map((participant) => [participant.context, participant])),
            removed: new Map(),
        });
        for (const participant of participants) this.pushElement(element, participant.context);
    }

    /**
     * Файл открыли уже после шага нескольких документов, который его тронул: шаг встаёт и
     * в новый бакет, как у эталона, где история привязана к ресурсу, а не к вкладке.
     * Зовётся на свежем бакете, поэтому порядок шагов в нём — порядок кладки.
     */
    public adopt(context: string, resource: string, label: string): void {
        const adopted = new Map<IUndoRedoElement, WorkspaceElementState>();
        for (const stack of this.undoStacks.values()) {
            for (const element of stack) {
                const state = this.workspaceElements.get(element);
                if (state === undefined || state.removed.size > 0 || state.participants.has(context)) continue;
                if (element.resources.includes(resource)) adopted.set(element, state);
            }
        }
        // Бакеты обходятся в порядке их создания, а не кладки шагов.
        const ordered = [...adopted].sort(([, a], [, b]) => a.order - b.order);
        for (const [element, state] of ordered) {
            state.participants.set(context, { context, label, owner: false });
            this.stack(this.undoStacks, context).push(element);
        }
    }

    public canUndo(context: string): boolean {
        return this.stack(this.undoStacks, context).length > 0;
    }

    public canRedo(context: string): boolean {
        return this.stack(this.redoStacks, context).length > 0;
    }

    public peekUndo(context: string): IUndoRedoElement | undefined {
        const stack = this.stack(this.undoStacks, context);
        return stack[stack.length - 1];
    }

    public peekRedo(context: string): IUndoRedoElement | undefined {
        const stack = this.stack(this.redoStacks, context);
        return stack[stack.length - 1];
    }

    /** `false` — откатывать нечего либо шаг отказался ({@link IUndoRedoElement.canUndo}); отказавший шаг остаётся в стеке. */
    public async undo(context: string): Promise<boolean> {
        const stack = this.stack(this.undoStacks, context);
        const element = stack.at(-1);
        if (!element) return false;
        if (!this.checkWorkspaceElement(element, this.undoStacks, "undo")) return false;
        const canUndo = element.canUndo?.();
        // Синхронный ответ не ждём: тогда шаг уходит в redo-стек до первого
        // await (см. ниже). Промис — шаг спрашивает диск; пока спрашивал, стек
        // могли сдвинуть, и снимать тогда чужой верхний шаг нельзя.
        if (
            canUndo instanceof Promise
                ? !(await canUndo) || !this.isTopEverywhere(element, context, this.undoStacks)
                : canUndo === false
        ) {
            return false;
        }
        // Перемещаем по стекам синхронно (до await), чтобы немедленный redo сразу видел
        // элемент; синхронная часть element.undo() тоже успевает отработать до возврата.
        this.move(element, context, this.undoStacks, this.redoStacks);
        await element.undo();
        return true;
    }

    public async redo(context: string): Promise<boolean> {
        const stack = this.stack(this.redoStacks, context);
        const element = stack.at(-1);
        if (!element) return false;
        if (!this.checkWorkspaceElement(element, this.redoStacks, "redo")) return false;
        const canRedo = element.canRedo?.();
        if (
            canRedo instanceof Promise
                ? !(await canRedo) || !this.isTopEverywhere(element, context, this.redoStacks)
                : canRedo === false
        ) {
            return false;
        }
        this.move(element, context, this.redoStacks, this.undoStacks);
        await element.redo();
        return true;
    }

    /** Шаг нескольких документов с правкой этого буфера ломается: следующая отмена его сбросит. */
    public clear(context: string, reason: UndoClearReason = "closed"): void {
        for (const element of this.stack(this.undoStacks, context))
            this.leave(element, context, reason, this.undoStacks);
        for (const element of this.stack(this.redoStacks, context))
            this.leave(element, context, reason, this.redoStacks);
        this.stack(this.undoStacks, context).length = 0;
        this.stack(this.redoStacks, context).length = 0;
    }

    /** Уход бакета со своей правкой ломает шаг: в undo он помечается сломанным, из redo уходит отовсюду. */
    private leave(
        element: IUndoRedoElement,
        context: string,
        reason: UndoClearReason,
        stacks: Map<string, IUndoRedoElement[]>,
    ): void {
        const state = this.workspaceElements.get(element);
        if (state === undefined) return;
        const participant = state.participants.get(context);
        // Stryker disable next-line ConditionalExpression: шаг лежит в бакете, только пока бакет — его участник (pushWorkspaceElement/adopt кладут обоих сразу, leave снимает обоих), поэтому участник здесь есть всегда
        if (participant === undefined) return;
        state.participants.delete(context);
        if (!participant.owner) return;
        if (stacks === this.undoStacks) {
            state.removed.set(participant.label, reason);
            return;
        }
        this.dropFromRedo(element, state);
    }

    /** Шаг нескольких документов, ушедший из redo одного бакета, уходит из redo всех. */
    private truncateRedo(context: string): void {
        const redo = this.stack(this.redoStacks, context);
        // Копия: свой бакет шаг тоже покидает — правка массива на ходу.
        for (const element of [...redo]) {
            const state = this.workspaceElements.get(element);
            if (state !== undefined) this.dropFromRedo(element, state);
        }
        redo.length = 0;
    }

    private dropFromRedo(element: IUndoRedoElement, state: WorkspaceElementState): void {
        for (const context of state.participants.keys()) {
            const redo = this.stack(this.redoStacks, context);
            const index = redo.indexOf(element);
            // Stryker disable next-line ConditionalExpression: из redo шаг уходит только отсюда и сразу из всех участников, поэтому в redo участника он есть всегда; гард — от `splice(-1)`, который снял бы чужой шаг
            if (index >= 0) redo.splice(index, 1);
        }
    }

    /**
     * Отказ — строками эталона `cannotWorkspaceUndo*`. Сломанный шаг эталон тоже сбрасывает
     * целиком; не верхний в каком-то бакете эталон откатил бы «только этот файл», у нас шаг
     * не разбивается — отказ, история цела.
     */
    private checkWorkspaceElement(
        element: IUndoRedoElement,
        stacks: Map<string, IUndoRedoElement[]>,
        kind: "undo" | "redo",
    ): boolean {
        const state = this.workspaceElements.get(element);
        if (state === undefined) return true;
        if (state.removed.size > 0) {
            for (const context of state.participants.keys()) {
                this.stack(this.undoStacks, context).length = 0;
                this.truncateRedo(context);
            }
            this.onDidRefuseEmitter.fire({
                element,
                message: `Could not ${kind} '${element.label}' across all files. ${removedMessage(state.removed)}`,
            });
            return false;
        }
        const changed = [...state.participants.values()]
            .filter((participant) => this.stack(stacks, participant.context).at(-1) !== element)
            .map((participant) => participant.label);
        if (changed.length > 0) {
            this.onDidRefuseEmitter.fire({
                element,
                message: `Could not ${kind} '${element.label}' across all files because changes were made to ${changed.join(", ")}`,
            });
            return false;
        }
        return true;
    }

    /** Верхний ли шаг во всех своих бакетах (у обычного шага — в своём). */
    private isTopEverywhere(
        element: IUndoRedoElement,
        context: string,
        stacks: Map<string, IUndoRedoElement[]>,
    ): boolean {
        return this.contextsOf(element, context).every((each) => this.stack(stacks, each).at(-1) === element);
    }

    /** Снимает верхний шаг со всех его бакетов в `from` и кладёт в `to`. */
    private move(
        element: IUndoRedoElement,
        context: string,
        from: Map<string, IUndoRedoElement[]>,
        to: Map<string, IUndoRedoElement[]>,
    ): void {
        for (const each of this.contextsOf(element, context)) {
            this.stack(from, each).pop();
            this.stack(to, each).push(element);
        }
    }

    private contextsOf(element: IUndoRedoElement, context: string): string[] {
        const state = this.workspaceElements.get(element);
        return state === undefined ? [context] : [...state.participants.keys()];
    }
}

/** Пояснение к сломанному шагу — строки `RemovedResources.createMessage` эталона. */
function removedMessage(removed: ReadonlyMap<string, UndoClearReason>): string {
    const closed = [...removed].filter(([, reason]) => reason === "closed").map(([label]) => label);
    const replaced = [...removed].filter(([, reason]) => reason === "replaced").map(([label]) => label);
    const messages: string[] = [];
    if (closed.length > 0) {
        messages.push(`The following files have been closed and modified on disk: ${closed.join(", ")}.`);
    }
    if (replaced.length > 0) {
        messages.push(`The following files have been modified in an incompatible way: ${replaced.join(", ")}.`);
    }
    return messages.join("\n");
}

export const UndoRedoServiceDIToken = token<UndoRedoService>("UndoRedoService");
