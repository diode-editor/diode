import type * as vscode from "vscode";

import { Uri } from "./vscodeTypes.ts";

type ApiCommandHandler = (...args: unknown[]) => unknown;

export interface IApiCommandsDeps {
    showTextDocument(uri: vscode.Uri, options?: vscode.TextDocumentShowOptions): Thenable<unknown>;
    openExternal(target: vscode.Uri): Thenable<boolean>;
}

/** Registered locally, never sent to the host registry (upstream's `registerCommand(false, …)`). */
export function createApiCommands(deps: IApiCommandsDeps): ReadonlyMap<string, ApiCommandHandler> {
    return new Map<string, ApiCommandHandler>([["vscode.open", (...args) => open(deps, args)]]);
}

/**
 * `command:` silently does nothing (upstream doesn't let commands run from here).
 * Deviation: with options upstream would open http(s) in an editor; we have no web editor,
 * so the link always goes outside and `label` is ignored.
 */
async function open(deps: IApiCommandsDeps, args: readonly unknown[]): Promise<void> {
    const [uriOrString, columnOrOptions, label] = args;
    validate("uriOrString", uriOrString, Uri.isUri(uriOrString) || isHttpString(uriOrString));
    validate(
        "columnOrOptions",
        columnOrOptions,
        columnOrOptions === undefined || typeof columnOrOptions === "number" || typeof columnOrOptions === "object",
    );
    validate("label", label, label === undefined || typeof label === "string");

    const resource = typeof uriOrString === "string" ? Uri.parse(uriOrString) : (uriOrString as vscode.Uri);
    if (resource.scheme === "command") return;
    if (resource.scheme === "http" || resource.scheme === "https") {
        await deps.openExternal(resource);
        return;
    }
    // Upstream turns `null`/`0` into "no column" (`!v ? v`) and a numeric column into options.
    const showOptions = !columnOrOptions
        ? undefined
        : typeof columnOrOptions === "number"
          ? { viewColumn: columnOrOptions as vscode.ViewColumn }
          : (columnOrOptions as vscode.TextDocumentShowOptions);
    await deps.showTextDocument(resource, showOptions);
}

function isHttpString(value: unknown): boolean {
    return typeof value === "string" && /^https?:/i.test(value);
}

/** Refusal worded exactly as upstream (`ExtHostCommands.registerApiCommand`). */
function validate(name: string, value: unknown, valid: boolean): void {
    if (valid) return;
    const received =
        typeof value === "object"
            ? JSON.stringify(value, null, "\t")
            : String(value as string | number | boolean | undefined);
    throw new Error(`Invalid argument '${name}' when running 'vscode.open', received: ${received} `);
}
