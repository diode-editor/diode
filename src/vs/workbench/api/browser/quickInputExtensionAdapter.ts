import { renderCodicons } from "../../../base/common/codicons.ts";
import type { InputValidation, QuickInputService } from "../../browser/parts/quickinput/quickInputService.ts";
import type {
    QuickPickSession,
    QuickPickSessionItem,
    QuickPickSessionState,
} from "../../browser/parts/quickinput/quickPickSession.ts";
import type { QuickPickItem } from "../../common/quickPickItem.ts";
import type { IQuickInputBoxRequest, IQuickInputSink } from "../common/iExtensionWindowSinks.ts";
import type {
    IWireQuickPickEvent,
    IWireQuickPickRequest,
    IWireQuickPickSessionItem,
    IWireQuickPickUpdate,
    IWireValidationMessage,
} from "../common/wireTypes.ts";

interface IExtensionQuickPickItem extends QuickPickSessionItem {
    readonly handle: number;
}

interface IExtensionQuickPick {
    readonly session: QuickPickSession<IExtensionQuickPickItem>;
    byHandle: ReadonlyMap<number, IExtensionQuickPickItem>;
}

/**
 * Request labels go through {@link renderCodicons}, except `value`: it is edited and goes back to
 * the extension. There is one overlay for the whole app: a token may only dismiss our own live
 * show; a preempted service has already resolved to `undefined` itself.
 */
export class QuickInputExtensionAdapter implements IQuickInputSink {
    private currentHandle: number | null = null;
    private readonly quickPicks = new Map<number, IExtensionQuickPick>();

    public constructor(private readonly quickInput: QuickInputService) {}

    public async showInputBox(request: IQuickInputBoxRequest): Promise<string | undefined> {
        const ask = request.validate;
        // Always pass the validator: without a channel it answers "ok" to any text, which for
        // the widget is the same as no validation.
        const validateInput = async (value: string): Promise<InputValidation | null> =>
            // Stryker disable next-line OptionalChaining: without `?.` validateInput rejects when the extension sent no validator, but it is called from the fire-and-forget runValidation branch, outside the test's stack. The "no validation" tests still PASS: the unhandled rejection crashes the runner (RuntimeError) instead of failing the test. A gap in localizing listener errors (docs/MUTATION.md → #275), not a gap in this line's tests.
            toValidation(await ask?.(value));
        this.currentHandle = request.handle;
        try {
            // No conditional spreads: for picker options a missing field and
            // `undefined` are the same, so a branch would be a needless seam.
            return await this.quickInput.input({
                title: renderLabel(request.title),
                prompt: renderLabel(request.prompt),
                placeholder: renderLabel(request.placeHolder),
                // `value` is not a label: the user edits it and it goes back to the extension.
                value: request.value,
                password: request.password,
                validateInput,
            });
        } finally {
            this.release(request.handle);
        }
    }

    public async showQuickPick(request: IWireQuickPickRequest): Promise<readonly number[] | undefined> {
        // Build the items once and reply with INDICES into this array: the extension
        // must get back its own objects, not ones rebuilt over the wire.
        const items: QuickPickItem[] = request.items.map((item) => ({
            label: renderCodicons(item.label),
            description: renderLabel(item.description),
        }));
        this.currentHandle = request.handle;
        try {
            if (!request.canPickMany) {
                const picked = await this.quickInput.quickPick({
                    title: renderLabel(request.title),
                    placeholder: renderLabel(request.placeHolder),
                    items,
                });
                if (picked === undefined) return undefined;
                return [items.indexOf(picked)];
            }
            const picked = await this.quickInput.quickPickMany({
                title: renderLabel(request.title),
                placeholder: renderLabel(request.placeHolder),
                items,
                picked: request.picked.map((index) => items[index]),
            });
            if (picked === undefined) return undefined;
            return picked.map((item) => items.indexOf(item));
        } finally {
            this.release(request.handle);
        }
    }

    public updateQuickPick(update: IWireQuickPickUpdate, emit: (event: IWireQuickPickEvent) => void): void {
        let pick = this.quickPicks.get(update.handle);
        if (pick === undefined) {
            pick = this.createQuickPick(update.handle, emit);
            this.quickPicks.set(update.handle, pick);
        }
        const changes = toSessionChanges(update, pick);
        // Hide before applying the diff, show after: the picker must open already
        // in the new state and close without flashing it.
        if (update.visible === false) pick.session.hide();
        pick.session.update(changes);
        if (update.visible === true) pick.session.show();
    }

    public disposeQuickPick(handle: number): void {
        const pick = this.quickPicks.get(handle);
        if (pick === undefined) return;
        this.quickPicks.delete(handle);
        pick.session.dispose();
    }

    private createQuickPick(handle: number, emit: (event: IWireQuickPickEvent) => void): IExtensionQuickPick {
        const handles = (items: readonly IExtensionQuickPickItem[]): number[] => items.map((item) => item.handle);
        const session = this.quickInput.createQuickPick<IExtensionQuickPickItem>({
            onDidChangeValue: (value) => {
                emit({ handle, kind: "changeValue", value });
            },
            onDidAccept: () => {
                emit({ handle, kind: "accept" });
            },
            onDidChangeActive: (items) => {
                emit({ handle, kind: "changeActive", items: handles(items) });
            },
            onDidChangeSelection: (items) => {
                emit({ handle, kind: "changeSelection", items: handles(items) });
            },
            onDidHide: () => {
                emit({ handle, kind: "hide" });
            },
        });
        return { session, byHandle: new Map() };
    }

    public cancel(handle: number): void {
        if (this.currentHandle !== handle) return;
        this.currentHandle = null;
        this.quickInput.cancel();
    }

    /** Clear the slot only if it is still ours: a preemption has already put another handle there. */
    private release(handle: number): void {
        if (this.currentHandle === handle) this.currentHandle = null;
    }
}

/** Silence (no validator) and `null` mean the same: the value is valid. */
function toValidation(message: IWireValidationMessage | null | undefined): InputValidation | null {
    if (message == null) return null;
    return { message: renderCodicons(message.message), severity: message.severity };
}

/** For picker options a missing field and an empty string mean different things. */
function renderLabel(text: string | undefined): string | undefined {
    return text === undefined ? undefined : renderCodicons(text);
}

/** Items are rebuilt entirely, and `activeItems`/`selectedItems` resolve against the NEW set. */
function toSessionChanges(
    update: IWireQuickPickUpdate,
    pick: IExtensionQuickPick,
): Partial<QuickPickSessionState<IExtensionQuickPickItem>> {
    const changes: Record<string, unknown> = {};
    for (const key of LABEL_FIELDS) {
        if (key in update) changes[key] = renderLabel(update[key] ?? undefined);
    }
    for (const key of PLAIN_FIELDS) {
        if (key in update) changes[key] = update[key] ?? undefined;
    }
    if (update.items !== undefined) {
        const items = update.items.map(toSessionItem);
        pick.byHandle = new Map(items.map((item) => [item.handle, item]));
        changes.items = items;
    }
    const resolve = (handles: readonly number[]): IExtensionQuickPickItem[] =>
        handles.flatMap((handle) => {
            const item = pick.byHandle.get(handle);
            return item === undefined ? [] : [item];
        });
    if (update.activeItems !== undefined) changes.activeItems = resolve(update.activeItems);
    if (update.selectedItems !== undefined) changes.selectedItems = resolve(update.selectedItems);
    return changes as Partial<QuickPickSessionState<IExtensionQuickPickItem>>;
}

const LABEL_FIELDS = ["title", "placeholder", "prompt"] as const;

/** `null` means "reset"; `value` is not a label, it gets edited. */
const PLAIN_FIELDS = [
    "step",
    "totalSteps",
    "value",
    "canSelectMany",
    "matchOnDescription",
    "matchOnDetail",
    "keepScrollPosition",
] as const;

/**
 * Our single-line row cannot show `detail`: it takes the description's place when there is no
 * description (as in `showQuickPick`), and is still passed as `detail` for search.
 */
function toSessionItem(item: IWireQuickPickSessionItem): IExtensionQuickPickItem {
    const shown = nonEmpty(item.description) ?? nonEmpty(item.detail);
    return {
        handle: item.handle,
        label: renderCodicons(item.label),
        description: renderLabel(shown),
        detail: item.detail,
        alwaysShow: item.alwaysShow,
    };
}

function nonEmpty(text: string | undefined): string | undefined {
    return text === "" ? undefined : text;
}
