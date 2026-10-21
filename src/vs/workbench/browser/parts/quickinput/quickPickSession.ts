import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import type { QuickPickElement } from "./quickPickElement.ts";

export interface QuickPickSessionItem extends QuickPickItem {
    /** Searched when {@link QuickPickSessionState.matchOnDetail} is set. */
    readonly detail?: string;
    readonly alwaysShow?: boolean;
}

export interface QuickPickSessionState<T extends QuickPickSessionItem> {
    readonly title: string | undefined;
    readonly step: number | undefined;
    readonly totalSteps: number | undefined;
    readonly placeholder: string | undefined;
    readonly prompt: string | undefined;
    readonly value: string;
    /** Upstream `valueSelection`, `[start, end)`; `undefined` puts the cursor at the end. */
    readonly valueSelection: readonly [number, number] | undefined;
    readonly validationMessage: string | undefined;
    readonly canSelectMany: boolean;
    /** With no `matchOn*` field set, the list isn't filtered. */
    readonly matchOnLabel: boolean;
    readonly matchOnDescription: boolean;
    readonly matchOnDetail: boolean;
    readonly keepScrollPosition: boolean;
    /** Upstream `itemActivation`; with `"none"`, Enter accepts the typed text rather than a row. */
    readonly itemActivation: "first" | "none";
    readonly items: readonly T[];
    readonly activeItems: readonly T[];
    readonly selectedItems: readonly T[];
}

export interface QuickPickSessionEvents<T extends QuickPickSessionItem> {
    onDidChangeValue(value: string): void;
    onDidAccept(): void;
    onDidChangeActive(items: readonly T[]): void;
    onDidChangeSelection(items: readonly T[]): void;
    onDidHide(): void;
}

/**
 * `claim` takes over the widget (the previous owner gets cancelled). The loss is delivered SYNCHRONOUSLY,
 * so an owner knows the widget is still its own without asking the slot.
 */
export interface IQuickInputSlot {
    claim(onLost: () => void): QuickPickElement;
    open(): void;
    /** Called only by the current owner. */
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
 * Upstream `QuickPick` (`platform/quickinput/browser/quickInput.ts`). Unlike the promise-based quickPick,
 * it is live: the owner changes state on the fly, and Enter does NOT close the picker — it only fires
 * `onDidAccept`, and the owner decides whether to close (as upstream).
 */
export class QuickPickSession<T extends QuickPickSessionItem> {
    private state: QuickPickSessionState<T> = DEFAULT_STATE;
    /** `null` while hidden. */
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
     * As upstream: changing items, the query or the match rules moves the active item to the first row,
     * and a programmatic query change also fires `onDidChangeValue`.
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
        // Stryker disable next-line ConditionalExpression: without a value change the state holds exactly what's already in the query line (user typing is stored there too, via `onQueryChange`), and rewriting the same text changes nothing
        if (valueChanged) view.setQuery(this.state.value);
        if (valueChanged || "valueSelection" in changes) this.applyValueSelection(view);
        const listChanged =
            (valueChanged && this.searches()) ||
            "items" in changes ||
            // Stryker disable next-line ConditionalExpression,StringLiteral: layout rebuilds the checkbox rows anyway (row width is checked on every layout); refiltering here states the intent, the frame is the same without it
            "canSelectMany" in changes ||
            "matchOnLabel" in changes ||
            "matchOnDescription" in changes ||
            "matchOnDetail" in changes;
        // Stryker disable next-line ConditionalExpression,LogicalOperator,BooleanLiteral,StringLiteral: the check only avoids rebuilding rows for nothing; without new checks the set is unchanged (user checks go into state immediately, via `onCheckedChange`), and refiltering sets it itself
        const checksChanged = !listChanged && "selectedItems" in changes;
        const ownerMovedActive = "activeItems" in changes;
        // Stryker disable next-line ConditionalExpression,LogicalOperator,BooleanLiteral: without refiltering the active item didn't move, and notifyActive stays silent anyway (deduplicated by the first item)
        const activeMayHaveMoved = !ownerMovedActive && listChanged;
        if (listChanged) this.fillList(view, this.state.keepScrollPosition && !valueChanged);
        // Stryker disable next-line ConditionalExpression: without new checks setCheckedItems sets the same set (user checks are already in state), so the frame is the same
        if (checksChanged) view.setCheckedItems(this.state.selectedItems);
        if (ownerMovedActive) this.applyActive(view);
        // Stryker disable next-line ConditionalExpression: without refiltering the active item stays put, and notifyActive stays silent by itself (deduplicated by the first item)
        if (activeMayHaveMoved) this.notifyActive(view);
        // Stryker disable next-line CallExpression: without marking dirty, layout won't rerun, and layout is what wraps the prompt and message — observable only in the live app (TestApp lays out every frame unconditionally); the gate is the quick-input e2e scenario (frame create-quick-pick-filtered)
        view.markDirty();
    }

    /** No-op if already visible or disposed. */
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

    /** `onDidHide` arrives through the same path as for Escape. */
    public hide(): void {
        if (this.view !== null) this.slot.release();
    }

    public dispose(): void {
        this.hide();
        this.disposed = true;
    }

    private configure(view: QuickPickElement): void {
        view.resetFlavorState();
        // Stryker disable next-line StringLiteral: the mode is read by a single `acceptMode === "value"` comparison, so any other string behaves like "item"
        view.acceptMode = "item";
        view.validationMessage = null;
        this.paintChrome(view);

        view.onQueryChange = (query) => {
            this.state = { ...this.state, value: query };
            this.events.onDidChangeValue(query);
            // The owner may have handed the widget off in response (file dialog); then the list is no longer ours.
            if (this.view !== view) return;
            if (!this.searches()) return;
            this.fillList(view, false);
            this.notifyActive(view);
        };
        view.onActiveItemChanged = () => {
            this.notifyActive(view);
        };
        view.onAccept = (item) => {
            // Selection first, then accept — upstream event order.
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

    private applyValueSelection(view: QuickPickElement): void {
        const selection = this.state.valueSelection;
        if (selection === undefined) return;
        view.setQuerySelection(selection[0], selection[1]);
    }

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
        // Checks match by identity: after the items are replaced, the old objects match nothing.
        view.setCheckedItems(this.state.selectedItems);
    }

    private searches(): boolean {
        const { matchOnLabel, matchOnDescription, matchOnDetail } = this.state;
        return matchOnLabel || matchOnDescription || matchOnDetail;
    }

    private filtered(): readonly T[] {
        const needle = this.state.value.trim().toLowerCase();
        const { matchOnLabel, matchOnDescription, matchOnDetail } = this.state;
        // As upstream: this is how the file dialog keeps the directory listing while the query holds a path.
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

    /** Silent, as upstream. An empty set clears the active item; an unknown item leaves it alone. */
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
        // Fire only on a real change, as upstream.
        if (active === this.state.activeItems.at(0)) return;
        const items = active === undefined ? [] : [active];
        this.state = { ...this.state, activeItems: items };
        this.events.onDidChangeActive(items);
    }
}

/** Upstream `getTitle`: "Title (2/3)". */
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
