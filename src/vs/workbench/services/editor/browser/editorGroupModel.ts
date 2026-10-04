import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";

/**
 * Стабильная идентичность группы на всё время её жизни. Не путать с ViewColumn:
 * номер колонки — производный индекс в полосе групп и пересчитывается при
 * схлопывании/перестановке, а id остаётся.
 */
export type GroupId = number;

/**
 * Снимок идущей серии Ctrl+Tab для видимого списка переключателя: замороженный
 * MRU-список серии и позиция цикла в нём. `null` в событии
 * {@link EditorGroup.onDidChangeMruCycle} означает «серия кончилась».
 */
export interface MruCycleState {
    readonly panes: readonly IEditorPane[];
    readonly pointer: number;
}

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
    /**
     * Единственная вкладка-предпросмотр группы либо `null`. Хранится ссылкой на
     * панель, а не индексом: индексы ездят при вставке/закрытии соседей, а
     * «приколота ли вкладка» — свойство самой вкладки (так же устроен `preview`
     * в `editorGroupModel` эталона).
     */
    private previewPaneValue: IEditorPane | null = null;

    private readonly onDidChangeEditorsEmitter = new Emitter<void>();
    private readonly onDidChangeActivePaneEmitter = new Emitter<IEditorPane | null>();
    private readonly onDidChangeMruCycleEmitter = new Emitter<MruCycleState | null>();

    public constructor(public readonly id: GroupId) {
        super();
        this.register({
            dispose: () => {
                for (const subscription of this.paneSubscriptions.values()) subscription.dispose();
                this.paneSubscriptions.clear();
                for (const pane of this.panes) pane.dispose();
                this.panes = [];
                this.previewPaneValue = null;
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
    public readonly onDidChangeEditors = this.onDidChangeEditorsEmitter.event;

    /** Смена активной вкладки группы (в т.ч. `null`, когда группа опустела). */
    public readonly onDidChangeActivePane = this.onDidChangeActivePaneEmitter.event;

    /**
     * Жизнь серии Ctrl+Tab: снимок замороженного списка с позицией цикла на
     * каждом шаге ({@link cycleMru}) и `null`, когда серия кончилась — по
     * коммиту ({@link endMruCycle}), обычному переключению или структурному
     * изменению группы. Подписчик — видимый список переключателя вкладок.
     */
    public readonly onDidChangeMruCycle = this.onDidChangeMruCycleEmitter.event;

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

    /** Вкладка-предпросмотр группы либо `null`. */
    public get previewPane(): IEditorPane | null {
        return this.previewPaneValue;
    }

    /** Приколота ли вкладка (всё, что не предпросмотр, приколото — как в эталоне). */
    public isPinned(pane: IEditorPane): boolean {
        return this.previewPaneValue !== pane;
    }

    /**
     * Прикалывает вкладку: она перестаёт быть предпросмотром и её больше не
     * замещают. No-op для уже приколотой — поэтому зовётся из всех триггеров
     * прикалывания без оглядки на состояние.
     */
    public pinPane(pane: IEditorPane): void {
        if (this.previewPaneValue !== pane) return;
        this.previewPaneValue = null;
        this.fireEditorsChanged();
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
    public insertPane(pane: IEditorPane, options: { index?: number; preview?: boolean } = {}): void {
        const index = options.index ?? this.panes.length;
        this.panes.splice(index, 0, pane);
        this.trackPane(pane, options);
        // Вставка до или на позицию активной сдвигает её вправо.
        if (index <= this.activeIndexValue) this.activeIndexValue++;
    }

    /**
     * Замещает вкладку на позиции `index` новой, НЕ трогая порядок полосы и
     * индекс активной вкладки: так открытие следующего предпросмотра занимает
     * слот предыдущего, вместо «закрыли → открыли в конце». Старая вкладка
     * диспозится. События не шлёт — их пошлёт {@link activateTab}, которым
     * вызывающий активирует новую вкладку (одна перерисовка на замещение).
     */
    public replacePane(index: number, pane: IEditorPane, options: { preview?: boolean } = {}): void {
        /* v8 ignore start -- defensive: индекс приходит из getPanes().indexOf собственной панели */
        if (index < 0 || index >= this.panes.length) return;
        /* v8 ignore stop */
        const replaced = this.panes[index];
        // Структурное изменение делает замороженный список серии Ctrl+Tab невалидным.
        this.stopMruCycle();
        this.forgetPane(replaced);
        const mruIndex = this.mruOrder.indexOf(replaced);
        if (mruIndex >= 0) this.mruOrder.splice(mruIndex, 1);
        this.panes[index] = pane;
        this.trackPane(pane, options);
        replaced.dispose();
    }

    /**
     * Берёт вкладку под присмотр группы: подписка на её видимые изменения плюс
     * признак предпросмотра. Защёлка «первая правка прикалывает» живёт здесь,
     * а не у триггера ввода: правка приезжает и извне — `applyEdit` расширения,
     * bulk edit по закрытому файлу, участник сохранения, — и в любом случае
     * обязана приколоть вкладку, а не дать её заместить.
     */
    private trackPane(pane: IEditorPane, { preview = false }: { preview?: boolean }): void {
        this.paneSubscriptions.set(
            pane,
            pane.onDidChangeState(() => {
                this.pinOnFirstEdit(pane);
                this.fireEditorsChanged();
            }),
        );
        // Вкладка может приехать уже грязной (дубль документа при сплите, общая
        // с другой группой модель) — предпросмотром такая не становится: её
        // несохранённые правки замещение потеряло бы.
        if (preview && !pane.isModified) this.previewPaneValue = pane;
    }

    /** Снимает вкладку с присмотра группы: подписка плюс признак предпросмотра. */
    private forgetPane(pane: IEditorPane): void {
        this.paneSubscriptions.get(pane)?.dispose();
        // Stryker disable next-line CallExpression: эквивалентен — удаление чистит только запись Map, сама подписка погашена строкой выше, и поведения за ней больше нет
        this.paneSubscriptions.delete(pane);
        if (this.previewPaneValue === pane) this.previewPaneValue = null;
    }

    /**
     * Прикалывание по правке: грязная вкладка перестаёт быть предпросмотром.
     * Это ЗАЩЁЛКА — undo до сохранённой версии снова делает буфер чистым, но
     * вкладку в предпросмотр не возвращает: обратно `previewPaneValue` не
     * ставит никто, а {@link trackPane} зовётся один раз на вкладку.
     */
    private pinOnFirstEdit(pane: IEditorPane): void {
        if (!pane.isModified) return;
        if (this.previewPaneValue === pane) this.previewPaneValue = null;
    }

    /**
     * Снимает вкладку БЕЗ dispose — для переноса в другую группу. Владение
     * переходит вызывающему (тот обязан вставить панель в другую группу или
     * задиспозить сам). События активной вкладки — как у {@link closeTab}.
     */
    public detachPane(index: number): IEditorPane | null {
        if (index < 0 || index >= this.panes.length) return null;
        const pane = this.panes[index];
        this.forgetPane(pane);
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
                this.stopMruCycle();
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
            // Stryker disable next-line CallExpression: ветка недостижима по той же причине, что и для покрытия
            this.stopMruCycle();
            return;
        }
        /* v8 ignore stop */

        this.mruCyclePointer = (this.mruCyclePointer + direction + length) % length;
        const target = this.mruCycleList[this.mruCyclePointer];
        const targetIndex = this.panes.indexOf(target);
        /* v8 ignore start -- defensive: closing a tab clears cyclingActive, so the frozen target is always still open */
        if (targetIndex < 0) {
            // Stryker disable next-line CallExpression: ветка недостижима по той же причине, что и для покрытия
            this.stopMruCycle();
            return;
        }
        /* v8 ignore stop */
        this.activateTab(targetIndex, { mru: true });
        this.fireMruCycleChanged({ panes: [...this.mruCycleList], pointer: this.mruCyclePointer });
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
        this.stopMruCycle();
    }

    /** Снимок MRU-порядка (mru[0] — самый недавний). Для тестов и диагностики. */
    public getMruOrder(): IEditorPane[] {
        return [...this.mruOrder];
    }

    /**
     * Открытые вкладки группы в MRU-порядке: недавние первыми, а следом — те,
     * которых MRU-стек ещё не видел, в позиционном порядке полосы. Такие
     * вкладки бывают: `insertPane` в стек не пишет, и вкладка, приехавшая
     * merge'ом чужой группы и ни разу не активированная, в `mruOrder`
     * отсутствует. Отдельно от {@link getMruOrder} (сырой снимок стека) —
     * пикер открытых редакторов обязан показать ВСЕ вкладки группы, а не
     * только побывавшие активными.
     */
    public getMruPanes(): IEditorPane[] {
        // Фильтровать сам стек не нужно: закрытую вкладку (и уехавшую в другую
        // группу) вычищает из `mruOrder` общий `removePaneAt`, так что лишних
        // панелей в нём не бывает — не хватать в нём может только новых.
        return [...this.mruOrder, ...this.panes.filter((pane) => !this.mruOrder.includes(pane))];
    }

    public closeTab(index: number): void {
        if (index < 0 || index >= this.panes.length) return;

        const pane = this.panes[index];
        this.forgetPane(pane);
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
        this.stopMruCycle();

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

    /**
     * Гасит серию Ctrl+Tab и извещает подписчиков цикла. No-op вне серии, чтобы
     * структурные изменения без идущей серии не будили список переключателя.
     */
    private stopMruCycle(): void {
        if (!this.cyclingActive) return;
        this.cyclingActive = false;
        this.fireMruCycleChanged(null);
    }

    private fireEditorsChanged(): void {
        this.onDidChangeEditorsEmitter.fire();
    }

    private fireMruCycleChanged(state: MruCycleState | null): void {
        this.onDidChangeMruCycleEmitter.fire(state);
    }

    private fireActivePaneChanged(pane: IEditorPane | null): void {
        this.onDidChangeActivePaneEmitter.fire(pane);
    }
}
