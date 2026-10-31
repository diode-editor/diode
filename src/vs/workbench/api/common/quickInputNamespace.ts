import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { ExtHostQuickPick } from "./extHostQuickPick.ts";
import { type AsRelativePath, withResourceFields } from "./quickInputResource.ts";
import { InputBoxValidationSeverity, QuickPickItemKind } from "./vscodeTypes.ts";
import {
    type IWireQuickPickItem,
    type IWireValidationMessage,
    parseWireInputBoxResult,
    parseWireQuickPickEvent,
    parseWireQuickPickResult,
    type WireValidationSeverity,
} from "./wireTypes.ts";

/**
 * The picker reply comes back as INDICES: the extension must get back its own
 * items (`showQuickPick<T>` returns `T`), and items rebuilt from the wire would not be them.
 */
export interface IQuickInputApi {
    showInputBox(options?: vscode.InputBoxOptions, token?: vscode.CancellationToken): Thenable<string | undefined>;
    // An arrow property, not a method: `window` hands it to the extension as is.
    readonly showQuickPick: (
        items: unknown,
        options?: vscode.QuickPickOptions,
        token?: vscode.CancellationToken,
    ) => Thenable<unknown>;
    createQuickPick<T extends vscode.QuickPickItem>(): vscode.QuickPick<T>;
}

export function toWireValidation(
    outcome: string | vscode.InputBoxValidationMessage | undefined | null,
): IWireValidationMessage | null {
    if (outcome === undefined || outcome === null) return null;
    if (typeof outcome === "string") {
        // A bare string is always an error (as documented in vscode.d.ts).
        return outcome === "" ? null : { message: outcome, severity: "error" };
    }
    if (typeof outcome.message !== "string" || outcome.message === "") return null;
    return { message: outcome.message, severity: toWireSeverity(outcome.severity) };
}

/**
 * Compare NUMBERS: the extension has its own `InputBoxValidationSeverity` from its copy
 * of `vscode.d.ts`; there is no enum type shared with ours.
 */
function toWireSeverity(severity: number | undefined): WireValidationSeverity {
    if (severity === InputBoxValidationSeverity.Warning) return "warning";
    if (severity === InputBoxValidationSeverity.Info) return "info";
    return "error";
}

/**
 * Our single-line row cannot show `detail` on a separate line — it takes the place of
 * the description, but only when there is no description (docs/public/API-COVERAGE.md).
 */
export function toWireQuickPickItem(
    item: string | vscode.QuickPickItem,
    asRelativePath: AsRelativePath = (uri) => uri.fsPath,
): IWireQuickPickItem {
    if (typeof item === "string") return { label: item };
    const { label, description } = withResourceFields(item, asRelativePath);
    return { label, description: nonEmpty(description) ?? nonEmpty(item.detail) };
}

function nonEmpty(text: string | undefined): string | undefined {
    // Stryker disable next-line ConditionalExpression: the first operand is a fast path; `undefined === ""` is false too, so the second one filters out missing text as well
    return text === undefined || text === "" ? undefined : text;
}

/** `this` inside `validateInput` must stay the extension's options object. */
function makeValidator(options: vscode.InputBoxOptions | undefined): ((value: string) => unknown) | undefined {
    if (options?.validateInput === undefined) return undefined;
    // Stryker disable next-line OptionalChaining: the line above checks the method exists; `?.` covers an extension rewriting its options between the call and validation
    return (value: string): unknown => options.validateInput?.(value);
}

export function createQuickInputApi(
    rpc: SubprocessRpc,
    asRelativePath: AsRelativePath = (uri) => uri.fsPath,
): IQuickInputApi {
    let nextHandle = 1;
    const selectListeners = new Map<number, (index: number) => void>();
    rpc.handleNotification("window.showQuickPick.didSelectItem", (params) => {
        const p: { handle?: unknown; index?: unknown } = params;
        // A garbage handle is simply not found.
        if (typeof p.index === "number") selectListeners.get(p.handle as number)?.(p.index);
    });
    // A map, not a single slot: an extension may hold two `showInputBox` calls at once, and
    // validation of the first may still be in flight.
    const validators = new Map<number, ((value: string) => unknown) | undefined>();

    const quickPicks = new Map<number, ExtHostQuickPick<vscode.QuickPickItem>>();
    rpc.handleNotification("window.quickPick.event", (params) => {
        const event = parseWireQuickPickEvent(params);
        if (event === null) return;
        quickPicks.get(event.handle)?.acceptEvent(event);
    });

    rpc.handleRequest("window.inputBox.validate", async (params): Promise<IWireValidationMessage | null> => {
        const p: { handle?: unknown; value?: unknown } = params;
        // Stryker disable next-line ConditionalExpression: the handle check is a fast path; a garbage handle is not found in the validator map anyway, and the reply is the same null
        if (typeof p.handle !== "number" || typeof p.value !== "string") return null;
        const validate = validators.get(p.handle);
        if (validate === undefined) return null;
        const outcome = (await validate(p.value)) as string | vscode.InputBoxValidationMessage | undefined | null;
        return toWireValidation(outcome);
    });

    const bindCancellation = (handle: number, token: vscode.CancellationToken | undefined): (() => void) => {
        if (token === undefined) return () => undefined;
        const subscription = token.onCancellationRequested(() => {
            rpc.notify("window.quickInput.cancel", { handle });
        });
        return () => {
            subscription.dispose();
        };
    };

    return {
        createQuickPick: <T extends vscode.QuickPickItem>(): vscode.QuickPick<T> => {
            // The counter is shared with show* calls: the host uses it to address a single overlay.
            const handle = nextHandle++;
            const quickPick = new ExtHostQuickPick<T>(rpc, handle, () => quickPicks.delete(handle), asRelativePath);
            quickPicks.set(handle, quickPick as unknown as ExtHostQuickPick<vscode.QuickPickItem>);
            return quickPick;
        },

        showInputBox: async (options, token) => {
            if (token?.isCancellationRequested === true) return undefined;
            const handle = nextHandle++;
            const validate = makeValidator(options);
            // Store even `undefined`: with no validator the handler replies "ok".
            validators.set(handle, validate);
            const unbind = bindCancellation(handle, token);
            try {
                const result = parseWireInputBoxResult(
                    await rpc.request("window.showInputBox", {
                        handle,
                        title: options?.title,
                        prompt: options?.prompt,
                        placeHolder: options?.placeHolder,
                        value: options?.value,
                        password: options?.password === true,
                        validates: validate !== undefined,
                    }),
                );
                return result.value ?? undefined;
            } finally {
                validators.delete(handle);
                unbind();
            }
        },

        showQuickPick: async (items, options, token) => {
            if (token?.isCancellationRequested === true) return undefined;
            const canPickMany = options?.canPickMany === true;
            const handle = nextHandle++;
            // Upstream `$show` first, `$setItems` later: the picker takes the widget in call order, and
            // a promise that never settles can still be cancelled.
            const pending = isThenable(items);
            let resolved = pending ? [] : pickableItems(items);
            let loadFailure: { readonly error: unknown } | undefined;
            selectListeners.set(handle, (index) => {
                const item = resolved.at(index);
                if (item !== undefined) options?.onDidSelectItem?.(item);
            });
            const unbind = bindCancellation(handle, token);
            const toWire = (item: string | vscode.QuickPickItem): IWireQuickPickItem =>
                toWireQuickPickItem(item, asRelativePath);
            const reply = rpc.request("window.showQuickPick", {
                handle,
                title: options?.title,
                placeHolder: options?.placeHolder,
                canPickMany,
                items: resolved.map(toWire),
                picked: pickedIndices(resolved, canPickMany),
                itemsPending: pending,
            });
            if (pending) {
                void Promise.resolve(items).then(
                    (loaded) => {
                        resolved = pickableItems(loaded);
                        rpc.notify("window.showQuickPick.items", {
                            handle,
                            items: resolved.map(toWire),
                            picked: pickedIndices(resolved, canPickMany),
                        });
                    },
                    (error: unknown) => {
                        loadFailure = { error };
                        rpc.notify("window.quickInput.cancel", { handle });
                    },
                );
            }
            try {
                const result = parseWireQuickPickResult(await reply);
                // Upstream rejects the caller with the error of its items promise.
                if (loadFailure !== undefined) throw loadFailure.error;
                if (result.indices === null) return undefined;
                // An out-of-range index is a reply to another prompt: otherwise the array would hold `undefined`.
                const picked = result.indices
                    .filter((index) => index < resolved.length)
                    .map((index) => resolved[index]);
                if (canPickMany) return picked;
                return picked.at(0);
            } finally {
                selectListeners.delete(handle);
                unbind();
            }
        },
    };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
    return typeof (value as { then?: unknown }).then === "function";
}

/** Our overlay has no group headers: a shown separator would become a pickable item. */
function pickableItems(items: unknown): readonly (string | vscode.QuickPickItem)[] {
    return (items as readonly (string | vscode.QuickPickItem)[]).filter(
        (item) =>
            // Stryker disable next-line ConditionalExpression,StringLiteral: the string check is a fast path; a string has no `kind` (`undefined`), so the second operand keeps it anyway
            typeof item === "string" || (item.kind as number | undefined) !== (QuickPickItemKind.Separator as number),
    );
}

function pickedIndices(items: readonly (string | vscode.QuickPickItem)[], canPickMany: boolean): number[] {
    if (!canPickMany) return [];
    const indices: number[] = [];
    for (const [index, item] of items.entries()) {
        // Stryker disable next-line ConditionalExpression,StringLiteral: the string check is a fast path; a string item's `picked` is `undefined` anyway, so the second operand filters it out
        if (typeof item !== "string" && item.picked === true) indices.push(index);
    }
    return indices;
}
