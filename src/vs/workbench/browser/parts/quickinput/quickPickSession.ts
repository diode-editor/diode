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
    /** Хранится, но не рисуется: индикатора загрузки у оверлея нет (API-COVERAGE). */
    readonly busy: boolean;
    /** Хранится, но поле ввода не блокирует (API-COVERAGE). */
    readonly enabled: boolean;
    readonly canSelectMany: boolean;
    readonly matchOnDescription: boolean;
    readonly matchOnDetail: boolean;
    readonly keepScrollPosition: boolean;
    readonly items: readonly T[];
    readonly activeItems: readonly T[];
    readonly selectedItems: readonly T[];
}

/** Что человек сделал с пикером — события `QuickPick` эталона. */
export interface QuickPickSessionEvents<T extends QuickPickSessionItem> {
    onDidChangeValue?(value: string): void;
    onDidAccept?(): void;
    onDidChangeActive?(items: readonly T[]): void;
    onDidChangeSelection?(items: readonly T[]): void;
    onDidHide?(): void;
}

/**
 * Слот общего виджета, который сервис выдаёт показу. `claim` перехватывает
 * виджет (прежний владелец — палитра, Quick Open, другой показ — получает
 * отмену) и запоминает, кому сообщить о потере; `release` снимает показ, если
 * виджет всё ещё его.
 */
export interface IQuickInputSlot {
    claim(onLost: () => void): { readonly view: QuickPickElement; readonly ticket: object };
    open(): void;
    release(ticket: object): void;
    owns(ticket: object): boolean;
}

const DEFAULT_STATE: QuickPickSessionState<never> = {
    title: undefined,
    step: undefined,
    totalSteps: undefined,
    placeholder: undefined,
    prompt: undefined,
    value: "",
    busy: false,
    enabled: true,
    canSelectMany: false,
    matchOnDescription: false,
    matchOnDetail: false,
    keepScrollPosition: false,
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
    private ticket: object | null = null;
    private view: QuickPickElement | null = null;
    private disposed = false;

    public constructor(
        private readonly slot: IQuickInputSlot,
        private readonly events: QuickPickSessionEvents<T>,
    ) {}

    public get visible(): boolean {
        return this.ticket !== null && this.slot.owns(this.ticket);
    }

    public getState(): QuickPickSessionState<T> {
        return this.state;
    }

    /**
     * Поменять состояние. Видимый пикер перерисовывается сразу; смена предметов
     * или запроса пересчитывает фильтр и, как в эталоне, ставит подсветку на
     * первую строку (без `keepScrollPosition`) — об этом владелец узнаёт
     * `onDidChangeActive`. Программная смена запроса тоже даёт `onDidChangeValue`
     * (эталон: событие шлёт сеттер `value`).
     */
    public update(changes: Partial<QuickPickSessionState<T>>): void {
        if (this.disposed) return;
        const previous = this.state;
        this.state = { ...previous, ...changes };
        const valueChanged = changes.value !== undefined && changes.value !== previous.value;
        if (valueChanged) this.events.onDidChangeValue?.(this.state.value);
        const view = this.liveView();
        if (view === null) return;
        this.paintChrome(view);
        if (changes.canSelectMany !== undefined && changes.canSelectMany !== previous.canSelectMany) {
            view.canPickMany = this.state.canSelectMany;
        }
        if (valueChanged) view.setQuery(this.state.value);
        const listChanged =
            valueChanged ||
            changes.items !== undefined ||
            changes.canSelectMany !== undefined ||
            changes.matchOnDescription !== undefined ||
            changes.matchOnDetail !== undefined;
        if (listChanged) {
            this.fillList(view, this.state.keepScrollPosition && !valueChanged);
        } else if (changes.selectedItems !== undefined) {
            view.setCheckedItems(this.state.canSelectMany ? this.state.selectedItems : []);
        }
        if (changes.activeItems !== undefined) {
            // Подсветку назвал владелец — она и встаёт, молча, даже если тот же
            // дифф заменил предметы (перефильтрация поставила бы первую строку).
            this.applyActive(view);
        } else if (listChanged) {
            this.notifyActive(view);
        }
        view.markDirty();
    }

    /** Показать (перехватив общий виджет). Уже видим — no-op. */
    public show(): void {
        if (this.disposed || this.visible) return;
        const { view, ticket } = this.slot.claim(() => {
            this.ticket = null;
            this.view = null;
            this.events.onDidHide?.();
        });
        this.ticket = ticket;
        this.view = view;
        this.configure(view);
        this.slot.open();
    }

    /** Скрыть; `onDidHide` придёт из того же пути, что и Escape. */
    public hide(): void {
        if (this.ticket !== null) this.slot.release(this.ticket);
    }

    public dispose(): void {
        if (this.disposed) return;
        this.hide();
        this.disposed = true;
    }

    private liveView(): QuickPickElement | null {
        return this.visible ? this.view : null;
    }

    /** Полная настройка виджета на показ: флейвор, колбэки, список. */
    private configure(view: QuickPickElement): void {
        view.resetFlavorState();
        // Stryker disable next-line StringLiteral: режим читается единственным сравнением `acceptMode === "value"`, поэтому любая другая строка ведёт себя как "item"
        view.acceptMode = "item";
        view.canPickMany = this.state.canSelectMany;
        view.validationMessage = null;
        this.paintChrome(view);

        view.onQueryChange = (query) => {
            this.state = { ...this.state, value: query };
            this.events.onDidChangeValue?.(query);
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
            this.events.onDidChangeSelection?.(picked);
            this.events.onDidAccept?.();
        };
        view.onAcceptEmpty = () => {
            this.events.onDidAccept?.();
        };
        view.onCheckedChange = () => {
            const checked = view.checkedItems;
            const selected = this.state.items.filter((item) => checked.has(item));
            this.state = { ...this.state, selectedItems: selected };
            this.events.onDidChangeSelection?.(selected);
        };
        view.onAcceptMany = () => {
            this.events.onDidAccept?.();
        };

        view.setQuery(this.state.value);
        this.fillList(view, false);
        this.applyActive(view);
        this.notifyActive(view);
    }

    /** Заголовок с шагами, подсказка, placeholder — то, что не трогает список. */
    private paintChrome(view: QuickPickElement): void {
        view.title = composeTitle(this.state);
        view.prompt = this.state.prompt;
        view.placeholder = this.state.placeholder ?? "";
    }

    private fillList(view: QuickPickElement, keepPosition: boolean): void {
        const visible = this.filtered();
        if (keepPosition) view.refreshItems(visible);
        else view.items = visible;
        // Отметки — по идентичности предмета: после замены предметов прежние
        // объекты в наборе ни с чем не совпадут, поэтому ставим набор заново.
        view.setCheckedItems(this.state.canSelectMany ? this.state.selectedItems : []);
    }

    private filtered(): readonly T[] {
        const needle = this.state.value.trim().toLowerCase();
        if (needle === "") return this.state.items;
        const { matchOnDescription, matchOnDetail } = this.state;
        const hit = (text: string | undefined): boolean => text?.toLowerCase().includes(needle) === true;
        return this.state.items.filter(
            (item) =>
                item.alwaysShow === true ||
                hit(item.label) ||
                (matchOnDescription && hit(item.description)) ||
                (matchOnDetail && hit(item.detail)),
        );
    }

    /** Программная подсветка (`activeItems =`) — молча, как в эталоне. */
    private applyActive(view: QuickPickElement): void {
        const first = this.state.activeItems.at(0);
        if (first === undefined) return;
        const index = view.items.indexOf(first);
        if (index >= 0) view.setActiveIndex(index);
    }

    private notifyActive(view: QuickPickElement): void {
        const active = view.items.at(view.selectedIndex) as T | undefined;
        const items = active === undefined ? [] : [active];
        // Подсветка не сдвинулась (перефильтровали, а первая строка та же) —
        // молчим, как эталон: событие только про настоящую смену.
        if (items.length === this.state.activeItems.length && items[0] === this.state.activeItems.at(0)) return;
        this.state = { ...this.state, activeItems: items };
        this.events.onDidChangeActive?.(items);
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
    if (state.title !== undefined && state.title !== "" && steps !== undefined) return `${state.title} (${steps})`;
    if (state.title !== undefined && state.title !== "") return state.title;
    return steps;
}
