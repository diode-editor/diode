import { Emitter, type Event } from "../../../base/common/event.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import type { IUndoRedoElement } from "./iUndoRedoElement.ts";

/** Контекст файловых/workspace-операций (отмена в проводнике). */
export const WORKSPACE_UNDO_CONTEXT = "workspace";

/**
 * Участник шага, охватывающего несколько документов (bulk edit): бакет
 * истории, в который шаг кладётся, и имя файла для сообщений.
 */
export interface IUndoParticipant {
    readonly context: string;
    /** Имя ресурса в сообщении об отказе (`a.ts`). */
    readonly label: string;
    /**
     * Шаг несёт правку буфера ЭТОГО бакета. Потерянный бакет (вкладку
     * закрыли, буфер перечитан с диска) ломает такой шаг: откатить правку
     * некуда. Бакет без своей правки (вкладка, в которой вызвали действие;
     * файл, открытый уже после правки) уходит из участников без последствий.
     */
    readonly owner: boolean;
}

/** Почему бакет потерял свою историю (см. {@link UndoRedoService.clear}). */
export type UndoClearReason = "closed" | "replaced";

/** Отказ отмены/повтора шага нескольких документов — текст для человека. */
export interface IUndoRefusal {
    readonly element: IUndoRedoElement;
    readonly message: string;
}

/** Состояние шага нескольких документов (`pushWorkspaceElement`). */
interface WorkspaceElementState {
    /** Порядок кладки — по нему шаги встают в бакет открытого позже файла. */
    readonly order: number;
    /** Бакет → участник. Бакет, потерявший историю, отсюда уходит. */
    readonly participants: Map<string, IUndoParticipant>;
    /** Потерянные бакеты с правкой шага: имя → причина. Непуст — шаг сломан. */
    readonly removed: Map<string, UndoClearReason>;
}

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
 *
 * Шаг, охватывающий несколько документов (`workspace.applyEdit`: «Move to a
 * new file», правки по нескольким файлам), лежит в бакетах ВСЕХ участников —
 * как workspace-элемент эталона в стеках всех своих ресурсов: Ctrl+Z из любой
 * затронутой вкладки откатывает весь шаг. Откат возможен, только когда шаг —
 * верхний во всех бакетах; иначе отказ с сообщением ({@link onDidRefuse}).
 * Отступление от эталона (решение человека): шаг не разбивается на части по
 * файлам — нет диалога «Undo in N Files / Undo this File» и отката «только
 * этого файла» при правках в соседнем.
 */
export class UndoRedoService {
    private undoStacks = new Map<string, IUndoRedoElement[]>();
    private redoStacks = new Map<string, IUndoRedoElement[]>();
    private readonly workspaceElements = new WeakMap<IUndoRedoElement, WorkspaceElementState>();
    private nextOrder = 0;

    private readonly onDidRefuseEmitter = new Emitter<IUndoRefusal>();
    /** Шаг нескольких документов не откатился/не повторился — сказать человеку почему. */
    public readonly onDidRefuse: Event<IUndoRefusal> = this.onDidRefuseEmitter.event;

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
        this.truncateRedo(context);
    }

    /**
     * Кладёт ОДИН шаг в бакеты всех участников (см. описание класса). Без
     * участников шаг уходит в бакет workspace-операций.
     */
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
     * Файл открыли в новом бакете уже после шага нескольких документов, который
     * его тронул (создал, переписал на диске): шаг встаёт и в этот бакет, и
     * Ctrl+Z из новой вкладки откатывает его, как у эталона, где история
     * привязана к ресурсу, а не к вкладке. Зовётся на свежем (пустом) бакете,
     * поэтому порядок шагов в нём — порядок их кладки.
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
     * отказался (`canUndo() === false`, см. {@link IUndoRedoElement.canUndo};
     * шаг нескольких документов — не верхний в одном из своих бакетов): в
     * отказе шаг остаётся в стеке, половинчато не применяется ничего.
     */
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

    /** Повторяет откаченный шаг; отказ — как в {@link undo}. */
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

    /**
     * Сбрасывает историю контекста: вкладку закрыли (`closed`) либо содержимое
     * буфера заменено целиком (`replaced` — перечитка с диска). Шаг нескольких
     * документов, несущий правку этого буфера, ломается: откатывать её больше
     * некуда, и следующая попытка отмены сбросит его (см. {@link undo}).
     */
    public clear(context: string, reason: UndoClearReason = "closed"): void {
        for (const element of this.stack(this.undoStacks, context))
            this.leave(element, context, reason, this.undoStacks);
        for (const element of this.stack(this.redoStacks, context))
            this.leave(element, context, reason, this.redoStacks);
        this.stack(this.undoStacks, context).length = 0;
        this.stack(this.redoStacks, context).length = 0;
    }

    /**
     * Бакет уходит из участников шага. Без своей правки — без последствий;
     * со своей — шаг ломается: в undo он помечается сломанным, из redo уходит
     * отовсюду (повторять правку некуда).
     */
    private leave(
        element: IUndoRedoElement,
        context: string,
        reason: UndoClearReason,
        stacks: Map<string, IUndoRedoElement[]>,
    ): void {
        const state = this.workspaceElements.get(element);
        // Stryker disable next-line ConditionalExpression: шаг лежит в бакете, только пока бакет — его участник (pushWorkspaceElement/adopt кладут обоих сразу, leave снимает обоих), поэтому при известном `state` участник есть всегда
        const participant = state?.participants.get(context);
        if (state === undefined || participant === undefined) return;
        state.participants.delete(context);
        if (!participant.owner) return;
        if (stacks === this.undoStacks) {
            state.removed.set(participant.label, reason);
            return;
        }
        this.dropFromRedo(element, state);
    }

    /**
     * Обрезает redo контекста. Шаг нескольких документов, ушедший из redo
     * одного бакета, повторить целиком уже нельзя — он уходит из redo всех.
     */
    private truncateRedo(context: string): void {
        const redo = this.stack(this.redoStacks, context);
        // Копия: свой бакет шаг тоже покидает — правка массива на ходу.
        for (const element of [...redo]) {
            const state = this.workspaceElements.get(element);
            if (state !== undefined) this.dropFromRedo(element, state);
        }
        redo.length = 0;
    }

    /** Убирает шаг нескольких документов из redo всех его бакетов. */
    private dropFromRedo(element: IUndoRedoElement, state: WorkspaceElementState): void {
        for (const context of state.participants.keys()) {
            const redo = this.stack(this.redoStacks, context);
            const index = redo.indexOf(element);
            // Stryker disable next-line ConditionalExpression: из redo шаг уходит только отсюда и сразу из всех участников, поэтому в redo участника он есть всегда; гард — от `splice(-1)`, который снял бы чужой шаг
            if (index >= 0) redo.splice(index, 1);
        }
    }

    /**
     * Можно ли трогать шаг нескольких документов прямо сейчас. Отказ — с
     * сообщением (строки эталона, `cannotWorkspaceUndo*`):
     * - сломан (бакет с его правкой потерян) — эталон сбрасывает историю всех
     *   его ресурсов: неразбиваемый шаг откатить по частям нельзя;
     * - не верхний в каком-то бакете — там правили после него. Эталон
     *   откатил бы «только этот файл», у нас шаг не разбивается: отказ,
     *   история цела — откатите сначала правки в названных файлах.
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
