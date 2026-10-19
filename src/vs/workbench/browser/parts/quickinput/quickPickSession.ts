import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import type { QuickPickElement } from "./quickPickElement.ts";

/** Строка объектного пикера: то, что видно, плюс поля, по которым идёт поиск. */
export interface QuickPickSessionItem extends QuickPickItem {
    /** Текст для поиска при {@link QuickPickSessionState.matchOnDetail}. */
    readonly detail?: string;
    /** Фильтр по запросу строку не прячет. */
    readonly alwaysShow?: boolean;
}

/** Состояние объектного пикера — то, что владелец задаёт и меняет на ходу. */
export interface QuickPickSessionState<T extends QuickPickSessionItem> {
    readonly title: string | undefined;
    readonly step: number | undefined;
    readonly totalSteps: number | undefined;
    readonly placeholder: string | undefined;
    readonly prompt: string | undefined;
    readonly value: string;
    /**
     * Выделение в строке запроса `[начало, конец)` — `valueSelection` эталона:
     * так диалог файлов показывает дописанный автодополнением хвост пути
     * выделенным, и следующая набранная буква его заменяет. Применяется вместе
     * с `value` (или само по себе); `undefined` — курсор в конце.
     */
    readonly valueSelection: readonly [number, number] | undefined;
    /** Сообщение под строкой запроса (ошибка) — `validationMessage` эталона. */
    readonly validationMessage: string | undefined;
    readonly canSelectMany: boolean;
    /** Искать ли по `label` (эталон: `matchOnLabel`). Ни одного поля — список не фильтруется. */
    readonly matchOnLabel: boolean;
    readonly matchOnDescription: boolean;
    readonly matchOnDetail: boolean;
    readonly keepScrollPosition: boolean;
    /**
     * Что подсвечивать при новых предметах — `itemActivation` эталона: первую
     * строку или ничего (тогда Enter принимает набранное, а не строку).
     */
    readonly itemActivation: "first" | "none";
    readonly items: readonly T[];
    readonly activeItems: readonly T[];
    readonly selectedItems: readonly T[];
}

/** Что человек сделал с пикером — события `QuickPick` эталона. */
export interface QuickPickSessionEvents<T extends QuickPickSessionItem> {
    onDidChangeValue(value: string): void;
    onDidAccept(): void;
    onDidChangeActive(items: readonly T[]): void;
    onDidChangeSelection(items: readonly T[]): void;
    onDidHide(): void;
}

/**
 * Слот общего виджета, который сервис выдаёт показу. `claim` перехватывает
 * виджет (прежний владелец — палитра, Quick Open, другой показ — получает
 * отмену) и запоминает, кому сообщить о потере. Потеря доходит СИНХРОННО —
 * Escape, клик мимо, чужой показ или `release` самого владельца, — поэтому
 * владелец знает, что виджет его, без отдельного вопроса слоту.
 */
export interface IQuickInputSlot {
    claim(onLost: () => void): QuickPickElement;
    open(): void;
    /** Закрыть показ; зовёт только текущий владелец. */
    release(): void;
}

const DEFAULT_STATE: QuickPickSessionState<never> = {
    title: undefined,
    step: undefined,
    totalSteps: undefined,
    placeholder: undefined,
    prompt: undefined,
    value: "",
    valueSelection: undefined,
    validationMessage: undefined,
    canSelectMany: false,
    matchOnLabel: true,
    matchOnDescription: false,
    matchOnDetail: false,
    keepScrollPosition: false,
    itemActivation: "first",
    items: [],
    activeItems: [],
    selectedItems: [],
};

/**
 * Объектный пикер на общем QuickInput-оверлее — `QuickPick` эталона
 * (`platform/quickinput/browser/quickInput.ts`), под ним `window.createQuickPick`
 * расширений.
 *
 * В отличие от промисных {@link import("./quickInputService.ts").QuickInputService.quickPick}
 * пикер ЖИВОЙ: владелец меняет предметы, запрос и прочее, пока он открыт, а
 * Enter его НЕ закрывает — он только сообщает о принятии (`onDidAccept`), и
 * закрывать ли — решает владелец (эталон). Скрытый пикер можно показать снова
 * с тем же состоянием.
 *
 * Фильтрация — та же, что у промисного пикера: подстрока без учёта регистра по
 * `label` (плюс `description`/`detail` по флагам, `alwaysShow` не прячется).
 */
export class QuickPickSession<T extends QuickPickSessionItem> {
    private state: QuickPickSessionState<T> = DEFAULT_STATE;
    /** Виджет, пока пикер показан; `null` — скрыт. */
    private view: QuickPickElement | null = null;
    private disposed = false;

    public constructor(
        private readonly slot: IQuickInputSlot,
        private readonly events: QuickPickSessionEvents<T>,
    ) {}

    public get visible(): boolean {
        return this.view !== null;
    }

    public getState(): QuickPickSessionState<T> {
        return this.state;
    }

    /**
     * Поменять состояние (присланы только изменённые поля). Видимый пикер
     * перерисовывается сразу; смена предметов, запроса или правил поиска
     * пересчитывает фильтр и, как в эталоне, ставит подсветку на первую строку
     * (без `keepScrollPosition`) — об этом владелец узнаёт `onDidChangeActive`.
     * Программная смена запроса тоже даёт `onDidChangeValue` (эталон: событие
     * шлёт сеттер `value`).
     */
    public update(changes: Partial<QuickPickSessionState<T>>): void {
        if (this.disposed) return;
        const previous = this.state;
        this.state = { ...previous, ...changes };
        const valueChanged = "value" in changes && changes.value !== previous.value;
        if (valueChanged) this.events.onDidChangeValue(this.state.value);
        const view = this.view;
        if (view === null) return;
        this.paintChrome(view);
        // Stryker disable next-line ConditionalExpression: без смены значения в состоянии лежит ровно то, что уже в строке запроса (набранное человеком кладётся туда же, `onQueryChange`), и повторная запись того же текста ничего не меняет
        if (valueChanged) view.setQuery(this.state.value);
        if (valueChanged || "valueSelection" in changes) this.applyValueSelection(view);
        const listChanged =
            (valueChanged && this.searches()) ||
            "items" in changes ||
            // Stryker disable next-line ConditionalExpression,StringLiteral: строки с чекбоксами пересоберёт и раскладка (ширина ряда сверяется на каждом layout), перефильтровка тут — явное намерение, кадр без неё тот же
            "canSelectMany" in changes ||
            "matchOnLabel" in changes ||
            "matchOnDescription" in changes ||
            "matchOnDetail" in changes;
        // Stryker disable next-line ConditionalExpression,LogicalOperator,BooleanLiteral,StringLiteral: проверка — чтобы не пересобирать строки вхолостую; без новых отметок набор тот же (отметки человека кладутся в состояние сразу, `onCheckedChange`), а перефильтровка ставит его сама
        const checksChanged = !listChanged && "selectedItems" in changes;
        const ownerMovedActive = "activeItems" in changes;
        // Stryker disable next-line ConditionalExpression,LogicalOperator,BooleanLiteral: без перефильтрации подсветка не сдвигалась, и notifyActive всё равно промолчит (дедупликация по первой строке)
        const activeMayHaveMoved = !ownerMovedActive && listChanged;
        if (listChanged) this.fillList(view, this.state.keepScrollPosition && !valueChanged);
        // Stryker disable next-line ConditionalExpression: без новых отметок setCheckedItems ставит тот же набор (отметки человека уже в состоянии) — кадр тот же
        if (checksChanged) view.setCheckedItems(this.state.selectedItems);
        if (ownerMovedActive) this.applyActive(view);
        // Stryker disable next-line ConditionalExpression: без перефильтрации подсветка на месте, и notifyActive промолчит сам (дедупликация по первой строке)
        if (activeMayHaveMoved) this.notifyActive(view);
        // Stryker disable next-line CallExpression: без пометки не перезапустится раскладка, а подсказку и сообщение переносит именно она — наблюдаемо только в живом приложении (TestApp раскладывает кадр безусловно); гейт — e2e-сценарий quick-input (кадр create-quick-pick-filtered)
        view.markDirty();
    }

    /** Показать (перехватив общий виджет). Уже видим или снят — no-op. */
    public show(): void {
        if (this.disposed || this.view !== null) return;
        const view = this.slot.claim(() => {
            this.view = null;
            this.events.onDidHide();
        });
        this.view = view;
        this.configure(view);
        this.slot.open();
    }

    /** Скрыть; `onDidHide` придёт тем же путём, что и от Escape. */
    public hide(): void {
        if (this.view !== null) this.slot.release();
    }

    public dispose(): void {
        this.hide();
        this.disposed = true;
    }

    /** Полная настройка виджета на показ: флейвор, колбэки, список. */
    private configure(view: QuickPickElement): void {
        view.resetFlavorState();
        // Stryker disable next-line StringLiteral: режим читается единственным сравнением `acceptMode === "value"`, поэтому любая другая строка ведёт себя как "item"
        view.acceptMode = "item";
        view.validationMessage = null;
        this.paintChrome(view);

        view.onQueryChange = (query) => {
            this.state = { ...this.state, value: query };
            this.events.onDidChangeValue(query);
            // Искать не по чему — список от запроса не зависит, подсветку не трогаем.
            if (!this.searches()) return;
            this.fillList(view, false);
            this.notifyActive(view);
        };
        view.onActiveItemChanged = () => {
            this.notifyActive(view);
        };
        view.onAccept = (item) => {
            // Одиночный выбор: принятая строка становится выбором, потом —
            // принятие (порядок событий эталона).
            const picked = [item as T];
            this.state = { ...this.state, selectedItems: picked };
            this.events.onDidChangeSelection(picked);
            this.events.onDidAccept();
        };
        view.onAcceptEmpty = () => {
            this.events.onDidAccept();
        };
        view.onCheckedChange = () => {
            const checked = view.checkedItems;
            const selected = this.state.items.filter((item) => checked.has(item));
            this.state = { ...this.state, selectedItems: selected };
            this.events.onDidChangeSelection(selected);
        };
        view.onAcceptMany = () => {
            this.events.onDidAccept();
        };

        view.setQuery(this.state.value);
        this.applyValueSelection(view);
        this.fillList(view, false);
        if (this.state.activeItems.length > 0) this.applyActive(view);
        this.notifyActive(view);
    }

    /** Выделение (или курсор в конце) в строке запроса — по {@link QuickPickSessionState.valueSelection}. */
    private applyValueSelection(view: QuickPickElement): void {
        const selection = this.state.valueSelection;
        if (selection === undefined) return;
        view.setQuerySelection(selection[0], selection[1]);
    }

    /** Заголовок с шагами, подсказка, placeholder, режим отметок — не сам список. */
    private paintChrome(view: QuickPickElement): void {
        view.title = composeTitle(this.state);
        view.prompt = this.state.prompt;
        view.placeholder = this.state.placeholder ?? "";
        view.canPickMany = this.state.canSelectMany;
        view.validationMessage = this.state.validationMessage ?? null;
        view.validationSeverity = "error";
    }

    private fillList(view: QuickPickElement, keepPosition: boolean): void {
        const visible = this.filtered();
        if (keepPosition) view.refreshItems(visible);
        else view.items = visible;
        if (this.state.itemActivation === "none") view.clearActive();
        // Отметки — по идентичности предмета: после замены предметов прежние
        // объекты в наборе ни с чем не совпадут, поэтому ставим набор заново.
        view.setCheckedItems(this.state.selectedItems);
    }

    /** Фильтрует ли запрос список (хоть одно поле поиска включено). */
    private searches(): boolean {
        const { matchOnLabel, matchOnDescription, matchOnDetail } = this.state;
        return matchOnLabel || matchOnDescription || matchOnDetail;
    }

    private filtered(): readonly T[] {
        const needle = this.state.value.trim().toLowerCase();
        const { matchOnLabel, matchOnDescription, matchOnDetail } = this.state;
        // Искать не по чему — список целиком (эталон: так диалог файлов держит
        // каталог, пока в строке запроса — путь).
        if (!this.searches()) return this.state.items;
        const hit = (text: string | undefined): boolean => text?.toLowerCase().includes(needle) === true;
        return this.state.items.filter(
            (item) =>
                item.alwaysShow === true ||
                (matchOnLabel && hit(item.label)) ||
                (matchOnDescription && hit(item.description)) ||
                (matchOnDetail && hit(item.detail)),
        );
    }

    /**
     * Программная подсветка (`activeItems =`) — молча, как в эталоне. Пустой
     * набор снимает подсветку; незнакомый предмет её не трогает.
     */
    private applyActive(view: QuickPickElement): void {
        if (this.state.activeItems.length === 0) {
            view.clearActive();
            return;
        }
        const index = view.items.indexOf(this.state.activeItems[0]);
        if (index >= 0) view.setActiveIndex(index);
    }

    private notifyActive(view: QuickPickElement): void {
        const index = view.selectedIndex;
        const active = index < 0 ? undefined : (view.items.at(index) as T | undefined);
        // Подсветка не сдвинулась (перефильтровали, а первая строка та же) —
        // молчим, как эталон: событие только про настоящую смену.
        if (active === this.state.activeItems.at(0)) return;
        const items = active === undefined ? [] : [active];
        this.state = { ...this.state, activeItems: items };
        this.events.onDidChangeActive(items);
    }
}

/** Заголовок с шагами многошагового ввода — `getTitle` эталона: «Title (2/3)». */
function composeTitle(state: QuickPickSessionState<QuickPickSessionItem>): string | undefined {
    const steps =
        state.step === undefined
            ? undefined
            : state.totalSteps === undefined
              ? String(state.step)
              : `${String(state.step)}/${String(state.totalSteps)}`;
    const title = state.title === "" ? undefined : state.title;
    if (title === undefined) return steps;
    return steps === undefined ? title : `${title} (${steps})`;
}
