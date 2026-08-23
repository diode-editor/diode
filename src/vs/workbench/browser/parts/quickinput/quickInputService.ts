import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

import type { QuickInputComponent } from "./quickInputComponent.ts";
import { QuickInputComponentDIToken } from "./quickInputComponent.ts";

export const QuickInputServiceDIToken = token<QuickInputService>("QuickInputService");

/**
 * Options for a single-line text prompt, mirroring VS Code's `showInputBox`.
 */
export interface InputBoxOptions {
    /** Title drawn in the overlay's top border. */
    title?: string;
    /** Subtitle drawn under the input (dim), e.g. an instruction. */
    prompt?: string;
    /** Ghost text shown when the field is empty. */
    placeholder?: string;
    /** Initial value; the cursor is seeded at the end. */
    value?: string;
    /**
     * Synchronous validation. Return a message to mark the value invalid (Enter
     * is blocked and the message is shown); return null when the value is OK.
     */
    validateInput?: (value: string) => string | null;
}

/**
 * Options for a list pick, mirroring VS Code's `showQuickPick`.
 */
export interface QuickPickOptions {
    /** Title drawn in the overlay's top border. */
    title?: string;
    /** Ghost text shown when the query field is empty. */
    placeholder?: string;
    /** The items to choose from. Filtered live by their `label` as the user types. */
    items: readonly QuickPickItem[];
    /** Row to pre-highlight when the picker opens (clamped into range; default 0). */
    activeIndex?: number;
    /**
     * Fired as the highlighted item changes (open, arrow navigation, filtering) —
     * the hook behind live preview (e.g. applying a theme while browsing). Receives
     * `undefined` when the filtered list is empty.
     */
    onDidChangeActive?: (item: QuickPickItem | undefined, index: number) => void;
}

/**
 * VS Code-style QuickInput service (the reusable "enter a value" / "pick from a
 * list" control).
 *
 * Виджетом и overlay-сессией владеет {@link QuickInputComponent} — общий с
 * {@link import("../../../contrib/quickaccess/browser/quickOpenService.ts").QuickOpenService}; сервис на каждый
 * показ полностью ре-инициализирует состояние и колбэки виджета. Only one
 * quick-input is ever active at a time; a new call cancels any previous one.
 *
 * Exposes the InputBox flavor (`input()`) and the list-pick flavor
 * (`quickPick()`). The file-dialog flavor reuses the same widget/session and is a
 * future addition.
 */
export class QuickInputService {
    public static dependencies = [QuickInputComponentDIToken] as const;

    private pendingResolve: ((value: string | QuickPickItem | undefined) => void) | null = null;

    public constructor(private readonly component: QuickInputComponent) {}

    /**
     * Prompt the user for a single line of text. Resolves with the entered value
     * on Enter, or `undefined` if the prompt is dismissed (Escape / outside
     * click / superseded by another call).
     */
    public input(opts: InputBoxOptions = {}): Promise<string | undefined> {
        // A previous prompt still open? Cancel it before starting a new one.
        // (Включая чужой показ на общем виджете — например, открытый Quick Open.)
        this.settle(undefined);
        this.component.hide();

        return new Promise<string | undefined>((resolve) => {
            this.pendingResolve = resolve as (value: string | QuickPickItem | undefined) => void;
            this.takeOwnership();

            const view = this.component.view;
            view.acceptMode = "value";
            view.items = [];
            view.title = opts.title;
            view.prompt = opts.prompt;
            view.placeholder = opts.placeholder ?? "";
            view.validationSeverity = "error";
            // Clear any list-pick leftovers so a prior quickPick() can't fire here.
            view.onAccept = null;
            view.onActiveItemChanged = null;

            const validate = opts.validateInput;
            view.onQueryChange = (query) => {
                view.validationMessage = validate ? (validate(query) ?? null) : null;
                view.markDirty();
            };

            view.setQuery(opts.value ?? "");
            // Seed the validation state for the initial value.
            view.validationMessage = validate ? (validate(view.getQuery()) ?? null) : null;

            this.component.show();
        });
    }

    /**
     * Present a filterable list and resolve with the chosen {@link QuickPickItem}
     * on Enter, or `undefined` if dismissed (Escape / outside click / superseded).
     *
     * The list is filtered live by a case-insensitive substring match on each
     * item's `label`. `onDidChangeActive` fires whenever the highlighted item
     * changes (open, navigation, filtering) — the seam for live preview.
     */
    public quickPick(opts: QuickPickOptions): Promise<QuickPickItem | undefined> {
        // A previous pick still open? Cancel it before starting a new one.
        // (Включая чужой показ на общем виджете — например, открытый Quick Open.)
        this.settle(undefined);
        this.component.hide();

        return new Promise<QuickPickItem | undefined>((resolve) => {
            this.pendingResolve = resolve as (value: string | QuickPickItem | undefined) => void;
            this.takeOwnership();

            const allItems = opts.items;
            const view = this.component.view;
            view.acceptMode = "item";
            view.title = opts.title;
            view.prompt = undefined;
            view.placeholder = opts.placeholder ?? "";
            view.validationMessage = null;

            const notifyActive = (): void => {
                const index = view.selectedIndex;
                opts.onDidChangeActive?.(view.items[index], index);
            };

            const applyFilter = (query: string): void => {
                const needle = query.trim().toLowerCase();
                view.items =
                    needle === "" ? allItems : allItems.filter((it) => it.label.toLowerCase().includes(needle));
                // `items =` resets the highlight to the top; surface that as an active change.
                notifyActive();
            };

            view.onQueryChange = (query) => {
                applyFilter(query);
            };
            view.onActiveItemChanged = () => {
                notifyActive();
            };
            view.onAccept = (item) => {
                // Mirror the InputBox flavor: defer the close so the trailing key
                // event of this Enter does not land in the newly-focused editor.
                queueMicrotask(() => {
                    this.settle(item);
                });
            };

            view.setQuery("");
            view.items = allItems;
            if (opts.activeIndex !== undefined) view.setActiveIndex(opts.activeIndex);
            notifyActive();

            this.component.show();
        });
    }

    /**
     * Перехват общего виджета этим сервисом: колбэки отмены/принятия значения и
     * канал закрытия сессии перенастраиваются на текущий промис (Quick Open при
     * своём открытии выставляет их обратно на себя).
     */
    private takeOwnership(): void {
        const view = this.component.view;
        view.onCancel = () => {
            this.settle(undefined);
        };
        view.onAcceptValue = (value) => {
            // The widget already blocks Enter on a hard validation error.
            // Defer to a microtask (like QuickOpenService): closing the session here
            // restores focus to the editor, and doing that synchronously mid-keypress would
            // let the trailing key event of the same Enter land in the now-focused editor.
            queueMicrotask(() => {
                this.settle(value);
            });
        };
        this.component.onDidClose = () => {
            // Outside click / Escape / programmatic close all resolve as cancelled.
            this.settle(undefined);
        };
    }

    /** Resolve the pending promise exactly once and close the overlay. */
    private settle(value: string | QuickPickItem | undefined): void {
        const resolve = this.pendingResolve;
        if (resolve === null) return;
        this.pendingResolve = null;
        this.component.hide();
        resolve(value);
    }
}
