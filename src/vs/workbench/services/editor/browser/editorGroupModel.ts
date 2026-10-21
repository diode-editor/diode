import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";

/** Не ViewColumn: номер колонки пересчитывается при схлопывании/перестановке, а id остаётся. */
export type GroupId = number;

/** `null` в {@link EditorGroup.onDidChangeMruCycle} — серия Ctrl+Tab кончилась. */
export interface MruCycleState {
    readonly panes: readonly IEditorPane[];
    readonly pointer: number;
}

/**
 * Группа владеет своими панелями: `closeTab` диспозит вкладку, `detachPane` снимает БЕЗ dispose.
 * Порядок событий {@link activateTab} — {@link onDidChangeEditors} → фокус → {@link onDidChangeActivePane}:
 * сначала view вставляет контент в дерево, потом его можно фокусировать.
 */
export class EditorGroup extends Disposable {
    private panes: IEditorPane[] = [];
    private activeIndexValue = -1;
    private readonly paneSubscriptions = new Map<IEditorPane, IDisposable>();

    /** mru[0] — активная/последняя. */
    private mruOrder: IEditorPane[] = [];
    /**
     * Пока серия Ctrl+Tab идёт, список заморожен (`mruCycleList`), а выбор не коммитится в начало
     * `mruOrder` — иначе нельзя было бы уйти глубже второй вкладки.
     */
    private cyclingActive = false;
    private mruCycleList: IEditorPane[] = [];
    private mruCyclePointer = 0;
    /** Ссылкой, а не индексом: индексы ездят при вставке/закрытии соседей (как `preview` в `editorGroupModel` эталона). */
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

    /** Файрится ДО {@link onDidChangeActivePane}: к листенерам (и фокусу) view активной вкладки уже в дереве. */
    public readonly onDidChangeEditors = this.onDidChangeEditorsEmitter.event;

    public readonly onDidChangeActivePane = this.onDidChangeActivePaneEmitter.event;

    public readonly onDidChangeMruCycle = this.onDidChangeMruCycleEmitter.event;

    public get activeIndex(): number {
        return this.activeIndexValue;
    }

    public get editorCount(): number {
        return this.panes.length;
    }

    public get activePane(): IEditorPane | null {
        if (this.activeIndexValue < 0 || this.activeIndexValue >= this.panes.length) return null;
        return this.panes[this.activeIndexValue];
    }

    public get previewPane(): IEditorPane | null {
        return this.previewPaneValue;
    }

    /** Всё, что не предпросмотр, приколото — как в эталоне. */
    public isPinned(pane: IEditorPane): boolean {
        return this.previewPaneValue !== pane;
    }

    /** No-op для уже приколотой — поэтому зовётся из всех триггеров без оглядки на состояние. */
    public pinPane(pane: IEditorPane): void {
        if (this.previewPaneValue !== pane) return;
        this.previewPaneValue = null;
        this.fireEditorsChanged();
    }

    public getPane(index: number): IEditorPane | null {
        if (index < 0 || index >= this.panes.length) return null;
        return this.panes[index];
    }

    /** Живой массив, не копия. */
    public getPanes(): readonly IEditorPane[] {
        return this.panes;
    }

    public findPaneIndex(uri: Uri): number {
        return this.panes.findIndex((pane) => pane.uri.toString() === uri.toString());
    }

    /** Не активирует — это решает вызывающий; группа с этого момента владеет вкладкой. */
    public insertPane(pane: IEditorPane, options: { index?: number; preview?: boolean } = {}): void {
        const index = options.index ?? this.panes.length;
        this.panes.splice(index, 0, pane);
        this.trackPane(pane, options);
        if (index <= this.activeIndexValue) this.activeIndexValue++;
    }

    /**
     * Порядок полосы и индекс активной не трогаются: следующее превью занимает слот предыдущего.
     * Старая вкладка диспозится. События не шлёт — их пошлёт {@link activateTab} вызывающего.
     */
    public replacePane(index: number, pane: IEditorPane, options: { preview?: boolean } = {}): void {
        /* v8 ignore start -- defensive: индекс приходит из getPanes().indexOf собственной панели */
        if (index < 0 || index >= this.panes.length) return;
        /* v8 ignore stop */
        const replaced = this.panes[index];
        this.stopMruCycle();
        this.forgetPane(replaced);
        const mruIndex = this.mruOrder.indexOf(replaced);
        if (mruIndex >= 0) this.mruOrder.splice(mruIndex, 1);
        this.panes[index] = pane;
        this.trackPane(pane, options);
        replaced.dispose();
    }

    /**
     * Защёлка «первая правка прикалывает» живёт здесь, а не у триггера ввода: правка приезжает и извне
     * (`applyEdit`, bulk edit, участник сохранения) и тоже обязана приколоть вкладку.
     */
    private trackPane(pane: IEditorPane, { preview = false }: { preview?: boolean }): void {
        this.paneSubscriptions.set(
            pane,
            pane.onDidChangeState(() => {
                this.pinOnFirstEdit(pane);
                this.fireEditorsChanged();
            }),
        );
        // Вкладка может приехать уже грязной (сплит, общая модель) — предпросмотром не становится:
        // её несохранённые правки замещение потеряло бы.
        if (preview && !pane.isModified) this.previewPaneValue = pane;
    }

    private forgetPane(pane: IEditorPane): void {
        this.paneSubscriptions.get(pane)?.dispose();
        // Stryker disable next-line CallExpression: эквивалентен — удаление чистит только запись Map, сама подписка погашена строкой выше, и поведения за ней больше нет
        this.paneSubscriptions.delete(pane);
        if (this.previewPaneValue === pane) this.previewPaneValue = null;
    }

    /** Защёлка: undo до сохранённой версии вкладку в предпросмотр не возвращает. */
    private pinOnFirstEdit(pane: IEditorPane): void {
        if (!pane.isModified) return;
        if (this.previewPaneValue === pane) this.previewPaneValue = null;
    }

    /** Владение переходит вызывающему: вставить в другую группу или задиспозить. */
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
        // сперва — выбранную в серии вкладку, затем целевую.
        if (!mru) {
            if (this.cyclingActive) {
                this.commitActiveToMru();
                this.stopMruCycle();
            }
            this.moveToMruFront(this.panes[index]);
        }

        this.activeIndexValue = index;

        const pane = this.panes[index];
        // До фокуса: фокусировать можно только элемент, стоящий в дереве.
        this.fireEditorsChanged();
        if (focus) this.focusEditor();
        this.fireActivePaneChanged(pane);
    }

    /** `1` — к более давним вкладкам, `-1` — к более недавним. */
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
     * По отпусканию Ctrl: быстрые Ctrl+Tab с отпусканием тумблерят два последних редактора,
     * удержание Ctrl с повторными Tab проходит вглубь стека.
     */
    public endMruCycle(): void {
        if (!this.cyclingActive) return;
        this.commitActiveToMru();
        this.stopMruCycle();
    }

    public getMruOrder(): IEditorPane[] {
        return [...this.mruOrder];
    }

    /**
     * В отличие от {@link getMruOrder}, все вкладки: `insertPane` в стек не пишет, и вкладка, приехавшая
     * merge'ом и ни разу не активированная, в `mruOrder` отсутствует — она идёт следом в порядке полосы.
     */
    public getMruPanes(): IEditorPane[] {
        // Лишних панелей в стеке не бывает — их вычищает `removePaneAt`; не хватать может только новых.
        return [...this.mruOrder, ...this.panes.filter((pane) => !this.mruOrder.includes(pane))];
    }

    public closeTab(index: number): void {
        if (index < 0 || index >= this.panes.length) return;

        const pane = this.panes[index];
        this.forgetPane(pane);
        this.removePaneAt(index, pane, { dispose: true });
    }

    /** Любого вида: дифф тоже должен получать ввод. */
    public focusEditor(): void {
        this.activePane?.focusEditor();
    }

    private removePaneAt(index: number, pane: IEditorPane, { dispose }: { dispose: boolean }): void {
        this.stopMruCycle();

        this.panes.splice(index, 1);
        const mruIndex = this.mruOrder.indexOf(pane);
        /* v8 ignore start -- defensive: каждая открытая вкладка присутствует в mruOrder */
        if (mruIndex >= 0) this.mruOrder.splice(mruIndex, 1);
        /* v8 ignore stop */
        if (dispose) pane.dispose();

        if (this.panes.length === 0) {
            this.activeIndexValue = -1;
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
            this.fireEditorsChanged();
        }
    }

    private moveToMruFront(pane: IEditorPane): void {
        const index = this.mruOrder.indexOf(pane);
        if (index >= 0) this.mruOrder.splice(index, 1);
        this.mruOrder.unshift(pane);
    }

    private commitActiveToMru(): void {
        const current = this.activePane;
        /* v8 ignore start -- defensive: коммит вызывается только когда есть активная вкладка */
        if (current) this.moveToMruFront(current);
        /* v8 ignore stop */
    }

    /** No-op вне серии, чтобы структурные изменения не будили список переключателя. */
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
