import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { ExtHostQuickPick } from "./extHostQuickPick.ts";
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
export function toWireQuickPickItem(item: string | vscode.QuickPickItem): IWireQuickPickItem {
    if (typeof item === "string") return { label: item };
    return { label: item.label, description: nonEmpty(item.description) ?? nonEmpty(item.detail) };
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

export function createQuickInputApi(rpc: SubprocessRpc): IQuickInputApi {
    let nextHandle = 1;
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
            const quickPick = new ExtHostQuickPick<T>(rpc, handle, () => quickPicks.delete(handle));
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
            const canPickMany = options?.canPickMany === true;
            // AWAIT the items promise: an empty overlay with a busy indicator is a state of the object
            // picker, which we don't have.
            const awaited = (await Promise.resolve(items)) as readonly (string | vscode.QuickPickItem)[];
            // Our overlay has no group headers: a shown separator would become a pickable item.
            const resolved = awaited.filter(
                (item) =>
                    // Stryker disable next-line ConditionalExpression,StringLiteral: the string check is a fast path; a string has no `kind` (`undefined`), so the second operand keeps it anyway
                    typeof item === "string" ||
                    (item.kind as number | undefined) !== (QuickPickItemKind.Separator as number),
            );
            if (token?.isCancellationRequested === true) return undefined;
            const handle = nextHandle++;
            const unbind = bindCancellation(handle, token);
            try {
                const result = parseWireQuickPickResult(
                    await rpc.request("window.showQuickPick", {
                        handle,
                        title: options?.title,
                        placeHolder: options?.placeHolder,
                        canPickMany,
                        items: resolved.map(toWireQuickPickItem),
                        picked: pickedIndices(resolved, canPickMany),
                    }),
                );
                if (result.indices === null) return undefined;
                // An out-of-range index is a reply to another prompt: otherwise the array would hold `undefined`.
                const picked = result.indices
                    .filter((index) => index < resolved.length)
                    .map((index) => resolved[index]);
                if (canPickMany) return picked;
                return picked.at(0);
            } finally {
                unbind();
            }
        },
    };
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
