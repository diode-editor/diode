import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";
import type { Uri } from "../../../../base/common/uri.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";

/**
 * Стабильная идентичность группы на всё время её жизни. Не путать с ViewColumn:
 * номер колонки — производный индекс в полосе групп и пересчитывается при
 * схлопывании/перестановке, а id остаётся.
 */
export type GroupId = number;

/**
 * Модель одной группы редакторов: список вкладок, активная вкладка и MRU-порядок
 * (Ctrl+Tab). Извлечена из `EditorService` под сплиты — сервис владеет полосой
 * таких групп и остаётся фасадом «активной группы» для потребителей.
 *
 * Группа владеет временем жизни своих панелей: `closeTab` диспозит вкладку,
 * `detachPane` снимает БЕЗ dispose (перенос между группами). Контракт порядка
 * событий в {@link activateTab} — {@link onDidChangeEditors} → фокус →
 * {@link onDidChangeActivePane}: сначала view-слой вставляет контент в дерево,
 * потом его можно фокусировать, и только затем срабатывают подписчики активного
 * редактора (статус-бар, host-адаптеры).
 */
export class EditorGroup extends Disposable {
    private panes: IEditorPane[] = [];
    private activeIndexValue = -1;
    /** Подписка на onDidChangeState каждой вкладки; снимается в close/detach. */
    private readonly paneSubscriptions = new Map<IEditorPane, IDisposable>();

    /**
     * Порядок вкладок от самой недавно использованной к самой давней
     * (mru[0] — активная/последняя). Отдельно от `panes` (позиционный порядок
     * в strip'е). Питает MRU-переключение Ctrl+Tab.
     */
    private mruOrder: IEditorPane[] = [];
    /**
     * Идёт ли сейчас серия Ctrl+Tab. Пока серия активна, список MRU заморожен
     * (`mruCycleList`), а выбор не коммитится в начало `mruOrder` — иначе нельзя
     * было бы уйти глубже второй вкладки. Любое обычное переключение или
     * структурное изменение завершает серию.
     */
    private cyclingActive = false;
    private mruCycleList: IEditorPane[] = [];
    private mruCyclePointer = 0;

    private editorsChangedListeners: (() => void)[] = [];
    private activePaneListeners: ((pane: IEditorPane | null) => void)[] = [];

    public constructor(public readonly id: GroupId) {
        super();
        this.register({
            dispose: () => {
                for (const subscription of this.paneSubscriptions.values()) subscription.dispose();
                this.paneSubscriptions.clear();
                for (const pane of this.panes) pane.dispose();
                this.panes = [];
            },
        });
    }

    /**
     * Любое изменение, требующее пересинхронизации view группы: список вкладок,
     * их метки/маркеры, активная вкладка. Подписчик — `EditorGroupComponent`
     * (перерисовывает tab strip и вставляет контент). Файрится ДО
     * {@link onDidChangeActivePane}, чтобы к моменту листенеров (и фокуса) view
     * активной вкладки уже стоял в дереве.
     */
    public onDidChangeEditors(cb: () => void): IDisposable {
        this.editorsChangedListeners.push(cb);
        return {
            dispose: () => {
                const idx = this.editorsChangedListeners.indexOf(cb);
                if (idx >= 0) this.editorsChangedListeners.splice(idx, 1);
            },
        };
    }

    /** Смена активной вкладки группы (в т.ч. `null`, когда группа опустела). */
    public onDidChangeActivePane(cb: (pane: IEditorPane | null) => void): IDisposable {
        this.activePaneListeners.push(cb);
        return {
            dispose: () => {
                const idx = this.activePaneListeners.indexOf(cb);
                if (idx >= 0) this.activePaneListeners.splice(idx, 1);
            },
        };
    }

    public get activeIndex(): number {
        return this.activeIndexValue;
    }

    public get editorCount(): number {
        return this.panes.length;
    }

    /** Активная вкладка группы, либо `null` у пустой группы. */
    public get activePane(): IEditorPane | null {
        if (this.activeIndexValue < 0 || this.activeIndexValue >= this.panes.length) return null;
        return this.panes[this.activeIndexValue];
    }

    public getPane(index: number): IEditorPane | null {
        if (index < 0 || index >= this.panes.length) return null;
        return this.panes[index];
    }

    /** Открытые панели в позиционном порядке вкладок (живой снимок для view-синхронизации). */
    public getPanes(): readonly IEditorPane[] {
        return this.panes;
    }

    /** Позиция вкладки ресурса в ЭТОЙ группе, либо -1 (пер-группный дедуп). */
    public findPaneIndex(uri: Uri): number {
        return this.panes.findIndex((pane) => pane.uri.toString() === uri.toString());
    }

    /**
     * Вставляет вкладку (в конец либо на `index`) и подписывается на её видимые
     * изменения. Не активирует — активацию решает вызывающий
     * ({@link activateTab}); группа лишь владеет самой вкладкой с этого момента.
     */
    public insertPane(pane: IEditorPane, options: { index?: number } = {}): void {
        const index = options.index ?? this.panes.length;
        this.panes.splice(index, 0, pane);
        this.paneSubscriptions.set(
            pane,
            pane.onDidChangeState(() => {
                this.fireEditorsChanged();
            }),
        );
        // Вставка до или на позицию активной сдвигает её вправо.
        if (index <= this.activeIndexValue) this.activeIndexValue++;
    }

    /**
     * Снимает вкладку БЕЗ dispose — для переноса в другую группу. Владение
     * переходит вызывающему (тот обязан вставить панель в другую группу или
     * задиспозить сам). События активной вкладки — как у {@link closeTab}.
     */
    public detachPane(index: number): IEditorPane | null {
        if (index < 0 || index >= this.panes.length) return null;
        const pane = this.panes[index];
        this.paneSubscriptions.get(pane)?.dispose();
        this.paneSubscriptions.delete(pane);
        this.removePaneAt(index, pane, { dispose: false });
        return pane;
    }

    public activateTab(index: number, { focus = true, mru = false }: { focus?: boolean; mru?: boolean } = {}): void {
        if (index < 0 || index >= this.panes.length) return;

        // Обычное переключение завершает серию Ctrl+Tab и коммитит в MRU:
        // сперва — недавно выбранную в серии вкладку, затем целевую.
        if (!mru) {
            if (this.cyclingActive) {
                this.commitActiveToMru();
                this.cyclingActive = false;
            }
            this.moveToMruFront(this.panes[index]);
        }

        this.activeIndexValue = index;

        const pane = this.panes[index];
        // View-слой вставляет контент активной вкладки и перерисовывает табы —
        // до фокуса: фокусировать можно только элемент, стоящий в дереве.
        this.fireEditorsChanged();
        if (focus) this.focusEditor();
        this.fireActivePaneChanged(pane);
    }

    /**
     * Переключение вкладок по принципу MRU (Ctrl+Tab / Ctrl+Shift+Tab).
     * `direction === 1` идёт к более давним вкладкам, `-1` — к более недавним.
     * Пока серия нажатий не прервана, порядок MRU заморожен, что позволяет
     * проходить по стеку глубже двух вкладок.
     */
    public cycleMru(direction: 1 | -1): void {
        if (this.panes.length < 2) return;

        if (!this.cyclingActive) {
            this.commitActiveToMru();
            this.mruCycleList = this.mruOrder.filter((pane) => this.panes.includes(pane));
            this.mruCyclePointer = 0;
            this.cyclingActive = true;
        }

        const length = this.mruCycleList.length;
        /* v8 ignore start -- defensive: cyclingActive is cleared on any structural change, so the frozen list always has ≥2 open editors here */
        if (length < 2) {
            this.cyclingActive = false;
            return;
        }
        /* v8 ignore stop */

        this.mruCyclePointer = (this.mruCyclePointer + direction + length) % length;
        const target = this.mruCycleList[this.mruCyclePointer];
        const targetIndex = this.panes.indexOf(target);
        /* v8 ignore start -- defensive: closing a tab clears cyclingActive, so the frozen target is always still open */
        if (targetIndex < 0) {
            this.cyclingActive = false;
            return;
        }
        /* v8 ignore stop */
        this.activateTab(targetIndex, { mru: true });
    }

    /**
     * Завершает серию Ctrl+Tab (вызывается по отпусканию Ctrl): фиксирует
     * выбранный в серии редактор в начале MRU-стека. Благодаря этому быстрые
     * нажатия Ctrl+Tab с отпусканием Ctrl тумблерят два последних редактора
     * (каждая серия — один шаг), а удержание Ctrl с повторными Tab проходит
     * вглубь стека (серия не завершается, список заморожен).
     */
    public endMruCycle(): void {
        if (!this.cyclingActive) return;
        this.commitActiveToMru();
        this.cyclingActive = false;
    }

    /** Снимок MRU-порядка (mru[0] — самый недавний). Для тестов и диагностики. */
    public getMruOrder(): IEditorPane[] {
        return [...this.mruOrder];
    }

    public closeTab(index: number): void {
        if (index < 0 || index >= this.panes.length) return;

        const pane = this.panes[index];
        this.paneSubscriptions.get(pane)?.dispose();
        this.paneSubscriptions.delete(pane);
        this.removePaneAt(index, pane, { dispose: true });
    }

    /** Фокус активной вкладки (любого вида: дифф тоже должен получать ввод). */
    public focusEditor(): void {
        this.activePane?.focusEditor();
    }

    /**
     * Общая механика удаления вкладки из списка: MRU, пересчёт активной,
     * события. `dispose` различает закрытие (панель умирает) и перенос
     * (панель уезжает в другую группу живой).
     */
    private removePaneAt(index: number, pane: IEditorPane, { dispose }: { dispose: boolean }): void {
        // Структурное изменение делает замороженный список серии невалидным.
        this.cyclingActive = false;

        this.panes.splice(index, 1);
        const mruIndex = this.mruOrder.indexOf(pane);
        /* v8 ignore start -- defensive: каждая открытая вкладка присутствует в mruOrder */
        if (mruIndex >= 0) this.mruOrder.splice(mruIndex, 1);
        /* v8 ignore stop */
        if (dispose) pane.dispose();

        if (this.panes.length === 0) {
            this.activeIndexValue = -1;
            // View-слой снимает контент закрытой вкладки (фокус гаснет вместе с ним).
            this.fireEditorsChanged();
            this.fireActivePaneChanged(null);
        } else if (index <= this.activeIndexValue) {
            this.activeIndexValue = Math.max(0, this.activeIndexValue - 1);
            const activePane = this.panes[this.activeIndexValue];
            this.moveToMruFront(activePane);
            this.fireEditorsChanged();
            this.focusEditor();
            this.fireActivePaneChanged(activePane);
        } else {
            // Закрыли вкладку после активной: активная не меняется, view-слою
            // достаточно перерисовать табы.
            this.fireEditorsChanged();
        }
    }

    private moveToMruFront(pane: IEditorPane): void {
        const index = this.mruOrder.indexOf(pane);
        if (index >= 0) this.mruOrder.splice(index, 1);
        this.mruOrder.unshift(pane);
    }

    /** Продвигает активную вкладку в начало MRU-стека (фиксирует выбор серии). */
    private commitActiveToMru(): void {
        const current = this.activePane;
        /* v8 ignore start -- defensive: коммит вызывается только когда есть активная вкладка */
        if (current) this.moveToMruFront(current);
        /* v8 ignore stop */
    }

    private fireEditorsChanged(): void {
        for (const cb of [...this.editorsChangedListeners]) cb();
    }

    private fireActivePaneChanged(pane: IEditorPane | null): void {
        for (const cb of [...this.activePaneListeners]) cb(pane);
    }
}
