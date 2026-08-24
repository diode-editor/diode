import * as fs from "node:fs";

import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";
import type { Uri } from "../../../../base/common/uri.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";

/**
 * Минимальный срез открытого редактора, нужный истории навигации: ресурс,
 * позиция каретки и умение туда прыгнуть. `TextEditorPane` соответствует ему
 * структурно, связывание делает DI-модуль ({@link HistoryEditorSourceDIToken}).
 */
export interface IHistoryEditor {
    readonly uri: Uri;
    /** 0-based строка первой каретки. */
    readonly primaryCursorLine: number;
    /** 0-based колонка первой каретки. */
    readonly primaryCursorColumn: number;
    goToPosition(line: number, column?: number): void;
}

/** Группа редакторов глазами истории: идентичность + список открытых ресурсов. */
export interface IHistoryEditorGroup {
    readonly id: number;
    getPanes(): readonly { readonly uri: Uri }[];
}

/** Поставщик редакторов и групп для {@link HistoryService}. */
export interface IHistoryEditorSource {
    readonly activeGroup: IHistoryEditorGroup;
    readonly groups: readonly IHistoryEditorGroup[];
    getActiveEditor(): IHistoryEditor | null;
    openUri(uri: Uri, options?: { focus?: boolean }): void;
    focusGroup(id: number, options?: { focus?: boolean }): void;
    onActiveEditorChanged(listener: (editor: IHistoryEditor | null) => void): IDisposable;
    onDidChangeActiveEditorSelection(listener: (editor: IHistoryEditor) => void): IDisposable;
}

/**
 * Шов «сейчас происходит прыжок» для сайтов навигации (Go to Definition,
 * Problems, результаты поиска, Go to Line).
 *
 * Зачем обёртка, а не флаг «следующее перемещение — прыжок»: сайт делает
 * `openUri` + `goToPosition` двумя шагами, между которыми история видит новый
 * редактор с кареткой в `0:0`. Без гашения промежутка в стек попала бы лишняя
 * запись «начало целевого файла», и первый Go Back вёл бы туда, а не в точку,
 * откуда прыгнули. Обёртка гасит всё промежуточное и кладёт ровно две записи —
 * origin и цель. Второй эффект: цель пишется в обход порога значимости, поэтому
 * намеренный прыжок на три строки в том же файле тоже попадает в историю.
 */
export interface IJumpRecorder {
    jump<T>(navigate: () => T): T;
}

/** Заглушка для юнит-тестов сайтов навигации: прыжок без записи в историю. */
export const NULL_JUMP_RECORDER: IJumpRecorder = {
    jump: (navigate) => navigate(),
};

// Stryker disable StringLiteral: token() возвращает новый Token, и разрешение зависимостей идёт по ссылке на него — строка внутри остаётся отладочной меткой, подменить её нечем наблюдаемым
export const HistoryEditorSourceDIToken = token<IHistoryEditorSource>("HistoryEditorSource");
export const HistoryServiceDIToken = token<HistoryService>("HistoryService");
export const JumpRecorderDIToken = token<IJumpRecorder>("JumpRecorder");
// Stryker restore StringLiteral

/** Точка в истории: ресурс, позиция каретки и группа, в которой её видели. */
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

/**
 * Порог «значимого» перемещения внутри одного файла — как
 * `MAX_SELECTION_LINE_DISTANCE` у VS Code. Перемещение ближе порога не заводит
 * новую запись, а обновляет текущую.
 */
const SIGNIFICANT_LINE_DISTANCE = 10;

/**
 * Схемы, которые история умеет восстановить. Всё остальное (`output:`, `git:`,
 * снимочные стороны диффа) в стек не попадает: `openUri` по ним либо бросит,
 * либо откроет не то, что пользователь видел.
 */
const RECORDABLE_SCHEMES = new Set(["file", "untitled"]);

/**
 * История навигации: Go Back / Go Forward по местам, где пользователь был
 * (аналог `IHistoryService` + `EditorNavigationStack` у VS Code).
 *
 * Стек ведётся двумя путями:
 * - **неявно** — подпиской на смену активного редактора и на перемещение
 *   каретки. Инвариант: `entries[index]` всегда зеркалит живую каретку, поэтому
 *   мелкое движение перезаписывает текущую запись, а не растит стек. Благодаря
 *   этому Back после прыжка возвращает в точку, где пользователь реально был, а
 *   не в ту, где он был десять нажатий стрелки назад;
 * - **явно** — обёрткой {@link jump} вокруг перехода (см. {@link IJumpRecorder}).
 *
 * Восстановление позиции (Back/Forward) гасится флагом `suspended`, иначе
 * собственный прыжок сервиса тут же записался бы новой записью и Forward стал бы
 * недостижим. Синхронного флага достаточно: `EditorViewState.selections` — это
 * сеттер, который синхронно зовёт `fireCursorChange()`, а редактор, панель и
 * `EditorService` только форвардят событие дальше без микротасков; открытие
 * ресурса и активация вкладки синхронны так же.
 *
 * Стек один на всё приложение (у VS Code их два уровня — глобальный и на
 * группу); группа запоминается в записи и восстанавливается перед открытием.
 */
export class HistoryService extends Disposable implements IWorkbenchContribution, IJumpRecorder {
    public static dependencies = [HistoryEditorSourceDIToken] as const;

    private readonly entries: IHistoryEntry[] = [];
    /** Указатель на текущую запись; `-1`, пока стек пуст. */
    private index = -1;
    /** Пока true, неявные продюсеры молчат: это мы сами двигаем каретку. */
    private suspended = false;

    public constructor(private readonly source: IHistoryEditorSource) {
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

    /**
     * Снимок стека — для тестов и диагностики (лезть в приватные поля запрещает
     * docs/TESTING.md), по образцу `EditorGroup.getMruOrder()`.
     */
    public getEntries(): readonly IHistoryEntry[] {
        return [...this.entries];
    }

    /** Индекс текущей записи в снимке {@link getEntries}; `-1` у пустого стека. */
    public get currentIndex(): number {
        return this.index;
    }

    public goBack(): void {
        this.navigate(-1);
    }

    public goForward(): void {
        this.navigate(1);
    }

    /** См. {@link IJumpRecorder.jump}. */
    public jump<T>(navigate: () => T): T {
        const origin = this.capture();
        this.suspended = true;
        let result: T;
        try {
            result = navigate();
        } finally {
            this.suspended = false;
        }
        // origin форсом: намеренный прыжок не должен съедаться порогом значимости.
        // Если позиция не изменилась, `record` просто освежит текущую запись.
        if (origin !== null) this.record(origin, true);
        const target = this.capture();
        if (target !== null) this.record(target, true);
        return result;
    }

    private navigate(delta: -1 | 1): void {
        this.prune();
        const target = this.index + delta;
        if (target < 0 || target >= this.entries.length) return;
        this.index = target;
        this.restore(this.entries[target]);
    }

    /**
     * Возвращает каретку в точку записи. Всё, что при этом произойдёт со
     * стеком, гасится `suspended` — иначе восстановление записалось бы новой
     * записью и forward-хвост был бы отсечён собственным же переходом.
     */
    private restore(entry: IHistoryEntry): void {
        this.suspended = true;
        try {
            if (entry.groupId !== this.source.activeGroup.id && this.groupExists(entry.groupId)) {
                this.source.focusGroup(entry.groupId);
            }
            this.source.openUri(entry.uri, { focus: true });
            const editor = this.source.getActiveEditor();
            /* v8 ignore start -- defensive: openUri либо активирует вкладку ресурса, либо
               заводит её; нечитаемые схемы отсеяны ещё при захвате записи */
            // Stryker disable next-line ConditionalExpression,LogicalOperator: ветка недостижима по той же причине, что и для покрытия
            if (editor === null || editor.uri.toString() !== entry.uri.toString()) return;
            /* v8 ignore stop */
            editor.goToPosition(entry.line, entry.character);
            // goToPosition клампит позицию к границам документа — записываем ту,
            // куда каретка встала на самом деле, иначе повторный Back застрянет.
            this.entries[this.index] = {
                uri: entry.uri,
                line: editor.primaryCursorLine,
                character: editor.primaryCursorColumn,
                groupId: this.source.activeGroup.id,
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

    /** Текущая позиция как запись стека; `null`, если её нечего записывать. */
    private capture(editor: IHistoryEditor | null = this.source.getActiveEditor()): IHistoryEntry | null {
        if (editor === null) return null;
        if (!RECORDABLE_SCHEMES.has(editor.uri.scheme)) return null;
        return {
            uri: editor.uri,
            line: editor.primaryCursorLine,
            character: editor.primaryCursorColumn,
            groupId: this.source.activeGroup.id,
        };
    }

    /**
     * Кладёт запись в стек. `force` — «это намеренный прыжок»: обходит порог
     * значимости, но не отменяет схлопывание записи в ту же самую точку.
     */
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
     * Выбрасывает записи, которые уже некуда восстановить, и чинит указатель.
     *
     * Зовётся лениво — только из {@link navigate}, раз на нажатие пользователя.
     * Подписаться на `onDidChangeEditors` нельзя: группа вешает на вкладку
     * `onDidChangeState`, а он у текстовой панели включает `onDidChangeContent`,
     * то есть событие приходит на каждое нажатие клавиши — чистка со `statSync`
     * по полусотне записей выполнялась бы сотни раз в секунду при наборе текста.
     * По той же причине `canGoBack`/`canGoForward` (их читает резолвер кейбиндов)
     * чистку не зовут и остаются оптимистичными.
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
        // Верхний зажим сработать не может: nextIndex = index минус выпавшие до него,
        // а выпавших ПОСЛЕ указателя не больше, чем позиций после него, — значит
        // nextIndex всегда не больше kept.length - 1. Держим страховкой на случай
        // изменения инварианта, но убить мутанта в ней нечем.
        // Stryker disable next-line ArithmeticOperator: недостижимая ветвь зажима, см. выше
        this.index = Math.min(Math.max(nextIndex, 0), kept.length - 1);
    }

    /**
     * Можно ли ещё вернуться в эту точку.
     *
     * Закрытая вкладка обычного файла историю не покидает — Back её переоткроет
     * (поведение VS Code; запись хранит ресурс, а не панель). Выбрасываем только
     * невосстановимое: удалённый с диска файл (иначе открыли бы пустой буфер) и
     * закрытый `untitled:`, которого больше нигде нет, а `openUri` по нему бросит.
     */
    private isReachable(entry: IHistoryEntry): boolean {
        if (entry.uri.scheme === "file") return fs.existsSync(entry.uri.fsPath);
        return this.source.groups.some((group) =>
            group.getPanes().some((pane) => pane.uri.toString() === entry.uri.toString()),
        );
    }

    private groupExists(id: number): boolean {
        return this.source.groups.some((group) => group.id === id);
    }
}
