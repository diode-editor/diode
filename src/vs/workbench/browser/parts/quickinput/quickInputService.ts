import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { QuickPickItem, ValidationSeverity } from "../../../common/quickPickItem.ts";

import type { QuickInputComponent } from "./quickInputComponent.ts";
import { QuickInputComponentDIToken } from "./quickInputComponent.ts";
import {
    type IQuickInputSlot,
    QuickPickSession,
    type QuickPickSessionEvents,
    type QuickPickSessionItem,
} from "./quickPickSession.ts";

export const QuickInputServiceDIToken = token<QuickInputService>("QuickInputService");

/** A bare string is an error (blocks Enter); an object with its own severity doesn't block Enter. */
export type InputValidation = string | { message: string; severity: ValidationSeverity };

export interface InputBoxOptions {
    title?: string;
    prompt?: string;
    placeholder?: string;
    /** The cursor is placed at the end. */
    value?: string;
    /** Masked only on screen and in the inspector; `validateInput` and the result get the real value. */
    password?: boolean;
    /** Responses that are stale by the time they arrive are dropped, so the message always matches the current text. */
    validateInput?: (value: string) => InputValidation | null | Promise<InputValidation | null>;
}

export interface QuickPickOptions {
    title?: string;
    placeholder?: string;
    items: readonly QuickPickItem[];
    /** Clamped to the list bounds; defaults to 0. */
    activeIndex?: number;
    /** Fires on open and on filtering too, not just on navigation; `undefined` means the list is empty. */
    onDidChangeActive?: (item: QuickPickItem | undefined, index: number) => void;
    /** Upstream `pick(Promise)`: the picker is open and cancellable while `items` is still empty. */
    lateItems?: Promise<LateQuickPickItems>;
}

export interface LateQuickPickItems {
    readonly items: readonly QuickPickItem[];
    readonly picked?: readonly QuickPickItem[];
}

/** Options for a multi-select list pick (`showQuickPick` with `canPickMany`). */
export interface QuickPickManyOptions {
    title?: string;
    placeholder?: string;
    items: readonly QuickPickItem[];
    /** Matched by item reference. */
    picked?: readonly QuickPickItem[];
    onDidChangeActive?: (item: QuickPickItem | undefined, index: number) => void;
    lateItems?: Promise<LateQuickPickItems>;
}

type QuickInputResult = string | QuickPickItem | readonly QuickPickItem[] | undefined;

function isThenable(value: unknown): value is Promise<InputValidation | null> {
    return typeof (value as { then?: unknown } | null)?.then === "function";
}

function blocksAccept(validation: InputValidation | null): boolean {
    return validation !== null && (typeof validation === "string" || validation.severity === "error");
}

/**
 * The widget and overlay session are owned by {@link QuickInputComponent}, shared with QuickOpenService:
 * every show re-initializes the widget's state and callbacks, and a new show cancels the previous one.
 */
export class QuickInputService {
    public static dependencies = [QuickInputComponentDIToken] as const;

    private pendingResolve: ((value: QuickInputResult) => void) | null = null;

    public constructor(private readonly component: QuickInputComponent) {}

    /** `undefined` means cancelled: Escape, a click outside, or another show taking over. */
    public input(opts: InputBoxOptions = {}): Promise<string | undefined> {
        // Including someone else's show on the shared widget, e.g. an open Quick Open.
        this.settle(undefined);
        this.component.hide();

        return new Promise<string | undefined>((resolve) => {
            const owner: (value: QuickInputResult) => void = resolve as (value: QuickInputResult) => void;
            this.pendingResolve = owner;
            this.takeOwnership();

            const view = this.component.view;
            view.resetFlavorState();
            view.acceptMode = "value";
            view.items = [];
            view.title = opts.title;
            view.prompt = opts.prompt;
            view.placeholder = opts.placeholder ?? "";
            view.password = opts.password === true;
            view.validationSeverity = "error";
            // Otherwise the previous quickPick()'s accept handler would fire here.
            view.onAccept = null;
            view.onActiveItemChanged = null;

            const validate = opts.validateInput;
            // Async validation races: the response for `ab` may arrive after the one for `abcde`.
            const validation = new LatestRequest();
            const showValidation = (outcome: InputValidation | null): void => {
                if (outcome === null) {
                    view.validationMessage = null;
                    view.validationSeverity = "error";
                } else if (typeof outcome === "string") {
                    view.validationMessage = outcome;
                    view.validationSeverity = "error";
                } else {
                    view.validationMessage = outcome.message;
                    view.validationSeverity = outcome.severity;
                }
                view.markDirty();
            };
            // Every text change starts its check at once (upstream debounces, we don't), so the latest
            // outcome is always for the text on screen.
            let latest: Promise<InputValidation | null>;
            const runValidation = (query: string): void => {
                const ticket = validation.start();
                const raw = validate === undefined ? null : validate(query);
                latest = Promise.resolve(raw);
                if (!isThenable(raw)) {
                    showValidation(raw);
                    return;
                }
                void raw.then((result) => {
                    if (ticket.isStale() || this.pendingResolve !== owner) return;
                    showValidation(result);
                });
            };
            view.onQueryChange = runValidation;
            // As upstream: Enter waits for the outcome on the accepted text. The message on screen may
            // still be the previous text's while a slow check (a disk lookup) is in flight.
            view.onAcceptValue = (value) => {
                void latest.then((result) => {
                    if (this.pendingResolve !== owner || blocksAccept(result)) return;
                    this.settle(value);
                });
            };

            view.setQuery(opts.value ?? "");
            runValidation(view.getQuery());

            this.component.show();
        });
    }

    public quickPick(opts: QuickPickOptions): Promise<QuickPickItem | undefined> {
        // Including someone else's show on the shared widget, e.g. an open Quick Open.
        this.settle(undefined);
        this.component.hide();

        return new Promise<QuickPickItem | undefined>((resolve) => {
            const owner = resolve as (value: QuickInputResult) => void;
            this.pendingResolve = owner;
            this.takeOwnership();

            const source = { items: opts.items };
            const view = this.configurePick(source, {
                title: opts.title,
                placeholder: opts.placeholder,
                canPickMany: false,
                onDidChangeActive: opts.onDidChangeActive,
            });
            this.fillLate(opts.lateItems, owner, source);
            view.onAccept = (item) => {
                // Deferred close: the rest of this Enter must not reach the editor that regains focus.
                queueMicrotask(() => {
                    this.settle(item);
                });
            };

            if (opts.activeIndex !== undefined) view.setActiveIndex(opts.activeIndex);
            opts.onDidChangeActive?.(view.items[view.selectedIndex], view.selectedIndex);

            this.component.show();
        });
    }

    /** Resolves in the original list order, as in VS Code; `[]` means nothing checked, `undefined` means cancelled. */
    public quickPickMany(opts: QuickPickManyOptions): Promise<readonly QuickPickItem[] | undefined> {
        // Stryker disable next-line CallExpression: duplicated by the next line — `hide()` already fires the previous owner's onDidClose, which resolves its promise to undefined; the explicit settle only states the intent
        this.settle(undefined);
        this.component.hide();

        return new Promise<readonly QuickPickItem[] | undefined>((resolve) => {
            const owner = resolve as (value: QuickInputResult) => void;
            this.pendingResolve = owner;
            this.takeOwnership();

            const source = { items: opts.items };
            const view = this.configurePick(source, {
                title: opts.title,
                placeholder: opts.placeholder,
                canPickMany: true,
                onDidChangeActive: opts.onDidChangeActive,
            });
            this.fillLate(opts.lateItems, owner, source);
            // Checks go in AFTER the list is filled: the rows themselves render them.
            // Stryker disable next-line ArrayDeclaration: replacing the empty array with a non-empty one changes nothing — checks are matched by list item identity, and a foreign object in the set matches none of them
            view.setCheckedItems(opts.picked ?? []);
            view.onAccept = null;
            view.onAcceptMany = () => {
                // Filter allItems, not `view.items`: checked items hidden by the query would be lost otherwise.
                const checked = view.checkedItems;
                const picked = source.items.filter((item) => checked.has(item));
                queueMicrotask(() => {
                    this.settle(picked);
                });
            };

            this.component.show();
        });
    }

    /** A show that has ended by then ignores its items. */
    private fillLate(
        late: Promise<LateQuickPickItems> | undefined,
        owner: (value: QuickInputResult) => void,
        source: { items: readonly QuickPickItem[] },
    ): void {
        void late?.then(({ items, picked }) => {
            if (this.pendingResolve !== owner) return;
            source.items = items;
            const view = this.component.view;
            view.onQueryChange?.(view.getQuery());
            if (picked !== undefined) view.setCheckedItems(picked);
            view.markDirty();
        });
    }

    private configurePick(
        source: { readonly items: readonly QuickPickItem[] },
        opts: {
            title?: string;
            placeholder?: string;
            canPickMany: boolean;
            onDidChangeActive?: (item: QuickPickItem | undefined, index: number) => void;
        },
    ): typeof this.component.view {
        const view = this.component.view;
        // Stryker disable next-line CallExpression: a safety net on the shared widget; both list flavors below set canPickMany themselves, and quickPickMany overwrites the checked set with setCheckedItems — removing the reset leaves no observable trace. Its real consumer is QuickOpenService, where it is tested
        view.resetFlavorState();
        // Stryker disable next-line StringLiteral: the mode is read by a single `acceptMode === "value"` comparison, so any other string behaves like "item"
        view.acceptMode = "item";
        view.canPickMany = opts.canPickMany;
        view.title = opts.title;
        view.prompt = undefined;
        view.placeholder = opts.placeholder ?? "";
        view.validationMessage = null;

        const notifyActive = (): void => {
            const index = view.selectedIndex;
            opts.onDidChangeActive?.(view.items[index], index);
        };

        view.onQueryChange = (query) => {
            // Stryker disable next-line MethodExpression: trim is cosmetic here — a leading space can't be typed into the query (in multi-select the check toggle eats it, and extra spaces inside a word don't narrow the filter anyway)
            const needle = query.trim().toLowerCase();
            // Stryker disable next-line ConditionalExpression,StringLiteral: the empty-query branch only skips a no-op filter pass; `includes("")` is true for any string, so the filtered list would equal the original
            view.items =
                needle === "" ? source.items : source.items.filter((it) => it.label.toLowerCase().includes(needle));
            notifyActive();
        };
        view.onActiveItemChanged = () => {
            notifyActive();
        };

        view.setQuery("");
        view.items = source.items;
        return view;
    }

    /** Upstream `createQuickPick`: closed only by its owner, Escape, or another show taking over the widget. */
    public createQuickPick<T extends QuickPickSessionItem>(
        events: QuickPickSessionEvents<T>,
        options: { readonly echoOwnerChanges?: boolean } = {},
    ): QuickPickSession<T> {
        return new QuickPickSession<T>(this.slot, events, options.echoOwnerChanges);
    }

    // Upstream `IQuickInputService.accept/cancel/navigate/toggle/focus`, for whoever owns the shared widget.
    // With nothing open they do nothing and do not fail.

    public acceptOpen(): void {
        if (this.component.isOpen()) this.component.view.accept();
    }

    /** The owner learns through `onDidClose`, the same path as Escape. */
    public closeOpen(): void {
        this.component.hide();
    }

    public navigateOpen(next: boolean): void {
        if (this.component.isOpen()) this.component.view.moveActive(next ? 1 : -1);
    }

    public toggleOpen(): void {
        if (this.component.isOpen()) this.component.view.toggleChecked();
    }

    public focusOpen(): void {
        if (this.component.isOpen()) this.component.view.focus();
    }

    /** The show's owner is `pendingResolve`, as with the promise flavors: a takeover (`settle`) tells it it lost. */
    private readonly slot: IQuickInputSlot = {
        claim: (onLost) => {
            // Stryker disable next-line CallExpression: duplicated by the next line — `hide()` already fires the previous owner's onDidClose, which ends its show itself; the explicit settle only states the intent (as in quickPickMany)
            this.settle(undefined);
            this.component.hide();
            this.pendingResolve = onLost;
            this.takeOwnership();
            return this.component.view;
        },
        open: () => {
            this.component.show();
        },
        release: () => {
            this.settle(undefined);
        },
    };

    public cancel(): void {
        this.settle(undefined);
    }

    /** Quick Open rebinds the widget callbacks back to itself when it opens. */
    private takeOwnership(): void {
        const view = this.component.view;
        view.onCancel = () => {
            this.settle(undefined);
        };
        view.onAcceptValue = (value) => {
            // Deferred close (as in QuickOpenService): returning focus synchronously mid-keypress
            // would hand the rest of the same Enter to the editor.
            queueMicrotask(() => {
                this.settle(value);
            });
        };
        this.component.onDidClose = () => {
            this.settle(undefined);
        };
    }

    private settle(value: QuickInputResult): void {
        const resolve = this.pendingResolve;
        if (resolve === null) return;
        this.pendingResolve = null;
        this.component.hide();
        resolve(value);
    }
}
