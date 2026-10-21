import * as fs from "node:fs";

import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";

/** `TextEditorPane` соответствует структурно; связывает DI-модуль ({@link HistoryEditorSourceDIToken}). */
export interface IHistoryEditor {
    readonly uri: Uri;
    /** 0-based. */
    readonly primaryCursorLine: number;
    /** 0-based. */
    readonly primaryCursorColumn: number;
    goToPosition(line: number, column?: number): void;
}

export interface IHistoryEditorGroup {
    readonly id: number;
    getPanes(): readonly { readonly uri: Uri }[];
}

export interface IHistoryEditorSource {
    getActiveEditor(): IHistoryEditor | null;
    openUri(uri: Uri, options?: { focus?: boolean }): void;
    /**
     * Недисковый ресурс — только пока его схему обслуживает провайдер содержимого
     * (`jdt:`); остальное история не записывает: вернуться туда она не сможет.
     */
    canRestore(uri: Uri): boolean;
    onActiveEditorChanged(listener: (editor: IHistoryEditor | null) => void): IDisposable;
    onDidChangeActiveEditorSelection(listener: (editor: IHistoryEditor) => void): IDisposable;
}

/**
 * Обёртка, а не флаг «следующее перемещение — прыжок»: между `openUri` и `goToPosition`
 * история видит новый редактор с кареткой в `0:0`, и первый Go Back вёл бы туда.
 * Кладёт ровно две записи — origin и цель, в обход порога значимости.
 */
export interface IJumpRecorder {
    jump<T>(navigate: () => T): T;
    /** Цель может приехать от провайдера схемы обещанием (`jdt:`) — точку назначения снимаем после. */
    jumpAsync(navigate: () => Promise<void>): Promise<void>;
}

export const NULL_JUMP_RECORDER: IJumpRecorder = {
    jump: (navigate) => navigate(),
    jumpAsync: (navigate) => navigate(),
};

// Stryker disable StringLiteral: token() возвращает новый Token, и разрешение зависимостей идёт по ссылке на него — строка внутри остаётся отладочной меткой, подменить её нечем наблюдаемым
export const HistoryEditorSourceDIToken = token<IHistoryEditorSource>("HistoryEditorSource");

export interface IHistoryGroupsSource {
    readonly activeGroup: IHistoryEditorGroup;
    readonly groups: readonly IHistoryEditorGroup[];
    focusGroup(id: number, options?: { focus?: boolean }): void;
}

export const HistoryGroupsSourceDIToken = token<IHistoryGroupsSource>("HistoryGroupsSource");
export const HistoryServiceDIToken = token<HistoryService>("HistoryService");
export const JumpRecorderDIToken = token<IJumpRecorder>("JumpRecorder");
// Stryker restore StringLiteral

export interface IHistoryEntry {
    readonly uri: Uri;
    /** 0-based. */
    readonly line: number;
    /** 0-based. */
    readonly character: number;
    readonly groupId: number;
}

/** Кап стека — как `EditorNavigationStack.MAX_STACK_SIZE` у VS Code. */
const MAX_STACK_SIZE = 50;

/** `MAX_SELECTION_LINE_DISTANCE` VS Code: ближе порога — обновить текущую запись, а не завести новую. */
const SIGNIFICANT_LINE_DISTANCE = 10;

/**
 * Аналог `IHistoryService` + `EditorNavigationStack`. Инвариант: `entries[index]`
 * зеркалит живую каретку — мелкое движение перезаписывает запись, а не растит стек.
 *
 * Синхронного флага `suspended` достаточно: `EditorViewState.selections` синхронно
 * зовёт `fireCursorChange()`, дальше событие форвардится без микротасков; открытие
 * ресурса и активация вкладки синхронны так же.
 *
 * Стек один на приложение (у VS Code — глобальный и на группу); группа хранится в записи.
 */
export class HistoryService extends Disposable implements IWorkbenchContribution, IJumpRecorder {
    public static dependencies = [HistoryEditorSourceDIToken, HistoryGroupsSourceDIToken] as const;

    private readonly entries: IHistoryEntry[] = [];
    /** `-1`, пока стек пуст. */
    private index = -1;
    /** Пока true, неявные продюсеры молчат: это мы сами двигаем каретку. */
    private suspended = false;

    public constructor(
        private readonly source: IHistoryEditorSource,
        private readonly groups: IHistoryGroupsSource,
    ) {
        super();

        this.register(
            this.source.onActiveEditorChanged((editor) => {
                this.recordEditor(editor);
            }),
        );
        this.register(
            this.source.onDidChangeActiveEditorSelection((editor) => {
                this.recordEditor(editor);
            }),
        );

        // Подхватываем редактор, ставший активным до создания сервиса.
        this.recordEditor(this.source.getActiveEditor());
    }

    public get canGoBack(): boolean {
        return this.index > 0;
    }

    public get canGoForward(): boolean {
        return this.index >= 0 && this.index < this.entries.length - 1;
    }

    public getEntries(): readonly IHistoryEntry[] {
        return [...this.entries];
    }

    public get currentIndex(): number {
        return this.index;
    }

    public goBack(): void {
        this.navigate(-1);
    }

    public goForward(): void {
        this.navigate(1);
    }

    public jump<T>(navigate: () => T): T {
        const origin = this.beginJump();
        let result: T;
        try {
            result = navigate();
        } finally {
            this.suspended = false;
        }
        this.endJump(origin);
        return result;
    }

    public async jumpAsync(navigate: () => Promise<void>): Promise<void> {
        const origin = this.beginJump();
        try {
            await navigate();
        } finally {
            this.suspended = false;
        }
        this.endJump(origin);
    }

    private beginJump(): IHistoryEntry | null {
        const origin = this.capture();
        this.suspended = true;
        return origin;
    }

    private endJump(origin: IHistoryEntry | null): void {
        // origin форсом: намеренный прыжок не должен съедаться порогом значимости.
        // Если позиция не изменилась, `record` просто освежит текущую запись.
        if (origin !== null) this.record(origin, true);
        const target = this.capture();
        if (target !== null) this.record(target, true);
    }

    private navigate(delta: -1 | 1): void {
        this.prune();
        const target = this.index + delta;
        if (target < 0 || target >= this.entries.length) return;
        this.index = target;
        this.restore(this.entries[target]);
    }

    /** Без `suspended` восстановление записалось бы новой записью и отсекло forward-хвост. */
    private restore(entry: IHistoryEntry): void {
        this.suspended = true;
        try {
            if (entry.groupId !== this.groups.activeGroup.id && this.groupExists(entry.groupId)) {
                this.groups.focusGroup(entry.groupId);
            }
            this.source.openUri(entry.uri, { focus: true });
            const editor = this.source.getActiveEditor();
            /* v8 ignore start -- defensive: openUri либо активирует вкладку ресурса, либо
               заводит её; нечитаемые схемы отсеяны ещё при захвате записи */
            // Stryker disable next-line ConditionalExpression,LogicalOperator: ветка недостижима по той же причине, что и для покрытия
            if (editor?.uri.toString() !== entry.uri.toString()) return;
            /* v8 ignore stop */
            editor.goToPosition(entry.line, entry.character);
            // goToPosition клампит позицию к границам документа — записываем ту,
            // куда каретка встала на самом деле, иначе повторный Back застрянет.
            this.entries[this.index] = {
                uri: entry.uri,
                line: editor.primaryCursorLine,
                character: editor.primaryCursorColumn,
                groupId: this.groups.activeGroup.id,
            };
        } finally {
            this.suspended = false;
        }
    }

    private recordEditor(editor: IHistoryEditor | null): void {
        if (editor === null) return;
        const entry = this.capture(editor);
        if (entry !== null) this.record(entry, false);
    }

    private capture(editor: IHistoryEditor | null = this.source.getActiveEditor()): IHistoryEntry | null {
        if (editor === null) return null;
        // `output:` и снимочные стороны диффа мимо: их содержимое пишет владелец вкладки,
        // а не адресуемый ресурс.
        if (!this.source.canRestore(editor.uri)) return null;
        return {
            uri: editor.uri,
            line: editor.primaryCursorLine,
            character: editor.primaryCursorColumn,
            groupId: this.groups.activeGroup.id,
        };
    }

    /** `force` обходит порог значимости, но не схлопывание записи в ту же самую точку. */
    private record(entry: IHistoryEntry, force: boolean): void {
        if (this.suspended) return;
        const current = this.entries[this.index] as IHistoryEntry | undefined;
        if (current === undefined) {
            this.push(entry);
            return;
        }
        const sameUri = current.uri.toString() === entry.uri.toString();
        if (sameUri && current.line === entry.line) {
            this.entries[this.index] = entry;
            return;
        }
        if (!force && sameUri && Math.abs(current.line - entry.line) < SIGNIFICANT_LINE_DISTANCE) {
            // Схлопывание соседних записей одного файла — именно веткой replace, а
            // не отдельным проходом по стеку: проход съел бы origin форсированного
            // прыжка на пару строк (Go to Definition рядом с местом вызова).
            this.entries[this.index] = entry;
            return;
        }
        this.push(entry);
    }

    private push(entry: IHistoryEntry): void {
        this.entries.splice(this.index + 1);
        this.entries.push(entry);
        if (this.entries.length > MAX_STACK_SIZE) this.entries.shift();
        this.index = this.entries.length - 1;
    }

    /**
     * Лениво, только из {@link navigate}: `onDidChangeEditors` приходит на каждое нажатие
     * (через `onDidChangeContent` панели), а чистка со `statSync` по полусотне записей —
     * сотни раз в секунду. Поэтому и `canGoBack`/`canGoForward` оптимистичны.
     */
    private prune(): void {
        const kept: IHistoryEntry[] = [];
        let nextIndex = this.index;
        for (let i = 0; i < this.entries.length; i++) {
            if (this.isReachable(this.entries[i])) {
                kept.push(this.entries[i]);
            } else if (i <= this.index) {
                nextIndex--;
            }
        }
        this.entries.splice(0, this.entries.length, ...kept);
        // Ранний выход только сокращает путь: при пустом kept общая формула ниже даёт
        // Math.min(что-то неотрицательное, -1), то есть тот же -1.
        // Stryker disable next-line ConditionalExpression: см. выше
        if (kept.length === 0) {
            this.index = -1;
            return;
        }
        // Верхний зажим сработать не может: выпавших после указателя не больше, чем позиций
        // после него, значит nextIndex ≤ kept.length - 1. Страховка на случай смены инварианта.
        // Stryker disable next-line ArithmeticOperator: недостижимая ветвь зажима, см. выше
        this.index = Math.min(Math.max(nextIndex, 0), kept.length - 1);
    }

    /**
     * Закрытая вкладка файла историю не покидает — Back её переоткроет, как VS Code.
     * Выбрасываем удалённый с диска файл (открылся бы пустой буфер) и закрытый
     * `untitled:`, по которому `openUri` бросит.
     */
    private isReachable(entry: IHistoryEntry): boolean {
        if (entry.uri.scheme === "file") return fs.existsSync(entry.uri.fsPath);
        return this.groups.groups.some((group) =>
            group.getPanes().some((pane) => pane.uri.toString() === entry.uri.toString()),
        );
    }

    private groupExists(id: number): boolean {
        return this.groups.groups.some((group) => group.id === id);
    }
}
