import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { type IWireMessageItem, parseWireShowMessageResult, type WireMessageSeverity } from "./wireTypes.ts";

/**
 * The reply comes back as an INDEX: `show*Message<T extends MessageItem>` returns `T`, and
 * the extension must get back ITS OWN object. For a message without buttons the host replies
 * immediately — the extension's promise does not hang for the toast's lifetime.
 */
export interface IMessageApi {
    // Arrow properties: `window` hands them out as is (`const { showErrorMessage } = vscode.window`).
    readonly showInformationMessage: (message: string, ...rest: unknown[]) => Thenable<unknown>;
    readonly showWarningMessage: (message: string, ...rest: unknown[]) => Thenable<unknown>;
    readonly showErrorMessage: (message: string, ...rest: unknown[]) => Thenable<unknown>;
}

export interface IParsedMessageArgs {
    readonly modal: boolean;
    readonly detail?: string;
    readonly items: readonly (string | vscode.MessageItem)[];
}

/** Upstream's test: `MessageItem` has `title`, `MessageOptions` does not. */
function isMessageItem(value: unknown): value is vscode.MessageItem {
    return typeof value === "object" && value !== null && "title" in value;
}

function nonEmpty(text: unknown): string | undefined {
    return typeof text === "string" && text !== "" ? text : undefined;
}

export function parseMessageArgs(first: unknown, rest: readonly unknown[]): IParsedMessageArgs {
    if (typeof first === "string" || isMessageItem(first)) {
        return { modal: false, items: [first, ...(rest as readonly (string | vscode.MessageItem)[])] };
    }
    // No check that this is actually an object: fields are read via `?.`, and garbage yields
    // the same result — "no options".
    const options = first as vscode.MessageOptions | undefined;
    return {
        modal: options?.modal === true,
        detail: nonEmpty(options?.detail),
        items: rest as readonly (string | vscode.MessageItem)[],
    };
}

export function toWireMessageItem(item: string | vscode.MessageItem): IWireMessageItem {
    if (typeof item === "string") return { title: item, isCloseAffordance: false };
    return { title: item.title, isCloseAffordance: item.isCloseAffordance === true };
}

export function createMessageApi(rpc: SubprocessRpc): IMessageApi {
    const show = async (
        severity: WireMessageSeverity,
        // `unknown`: a JS extension may pass anything.
        message: unknown,
        first: unknown,
        rest: readonly unknown[],
    ): Promise<unknown> => {
        const parsed = parseMessageArgs(first, rest);
        const result = parseWireShowMessageResult(
            await rpc.request("window.showMessage", {
                severity,
                // No type check: a string's string form is the string itself.
                message: String(message),
                modal: parsed.modal,
                detail: parsed.detail,
                items: parsed.items.map(toWireMessageItem),
            }),
        );
        if (result.index === null) return undefined;
        // An out-of-range index is a reply to another prompt: never return a hole in the buttons.
        return parsed.items.at(result.index);
    };

    return {
        showInformationMessage: (message, first?, ...rest) => show("info", message, first, rest),
        showWarningMessage: (message, first?, ...rest) => show("warn", message, first, rest),
        showErrorMessage: (message, first?, ...rest) => show("error", message, first, rest),
    };
}
