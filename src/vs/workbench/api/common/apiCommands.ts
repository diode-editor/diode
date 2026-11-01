import type * as vscode from "vscode";

import { Position, Range, SnippetString, Uri } from "./vscodeTypes.ts";

type ApiCommandHandler = (...args: unknown[]) => unknown;

export interface IApiCommandsDeps {
    showTextDocument(uri: vscode.Uri, options?: vscode.TextDocumentShowOptions): Thenable<unknown>;
    openExternal(target: vscode.Uri): Thenable<boolean>;
    openTextDocument(uri: vscode.Uri): Thenable<vscode.TextDocument>;
    executeCompletionItemProvider(
        document: vscode.TextDocument,
        position: vscode.Position,
        triggerCharacter: string | undefined,
        itemResolveCount: number | undefined,
    ): Promise<vscode.CompletionList>;
    executeCodeActionProvider(
        document: vscode.TextDocument,
        range: vscode.Range,
        kind: string | undefined,
        itemResolveCount: number | undefined,
    ): Promise<(vscode.CodeAction | vscode.Command)[]>;
    getActiveTextEditor(): vscode.TextEditor | undefined;
}

/** Registered locally, never sent to the host registry (upstream's `registerCommand(false, …)`). */
export function createApiCommands(deps: IApiCommandsDeps): ReadonlyMap<string, ApiCommandHandler> {
    return new Map<string, ApiCommandHandler>([
        ["vscode.open", (...args) => open(deps, args)],
        ["vscode.executeLinkProvider", (...args) => executeLinkProvider(args)],
        ["vscode.executeCompletionItemProvider", (...args) => executeCompletionItemProvider(deps, args)],
        ["vscode.executeCodeActionProvider", (...args) => executeCodeActionProvider(deps, args)],
        ["editor.action.insertSnippet", (...args) => insertSnippet(deps, args)],
    ]);
}

/**
 * Upstream's `InsertSnippetAction` with an inline `snippet`, on top of `TextEditor.insertSnippet`.
 * Deviation: `langId` + `name` look up contributed snippets upstream, and we have none: nothing happens.
 */
async function insertSnippet(deps: IApiCommandsDeps, args: readonly unknown[]): Promise<void> {
    const snippet = (args[0] as { readonly snippet?: unknown } | null | undefined)?.snippet;
    const editor = deps.getActiveTextEditor();
    if (typeof snippet !== "string" || editor === undefined) return;
    // `insertSnippet` reads only `value`; our class does not have upstream's `append*` builders.
    await editor.insertSnippet(new SnippetString(snippet) as unknown as vscode.SnippetString);
}

/**
 * `command:` silently does nothing (upstream doesn't let commands run from here).
 * Deviation: with options upstream would open http(s) in an editor; we have no web editor,
 * so the link always goes outside and `label` is ignored.
 */
async function open(deps: IApiCommandsDeps, args: readonly unknown[]): Promise<void> {
    const [uriOrString, columnOrOptions, label] = args;
    const validate = validatorOf("vscode.open");
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

/**
 * Deviation: always empty, the command is not wired to the link providers yet. The arguments are still checked,
 * as upstream.
 */
function executeLinkProvider(args: readonly unknown[]): Promise<readonly never[]> {
    const [uri, linkResolveCount] = args;
    const validate = validatorOf("vscode.executeLinkProvider");
    validate("uri", uri, Uri.isUri(uri));
    validate("linkResolveCount", linkResolveCount, isOptional(linkResolveCount, "number"));
    return Promise.resolve([]);
}

/** The document is opened as upstream's `createModelReference`: the command works on a file nobody opened. */
async function executeCompletionItemProvider(
    deps: IApiCommandsDeps,
    args: readonly unknown[],
): Promise<vscode.CompletionList> {
    const [uri, position, triggerCharacter, itemResolveCount] = args;
    const validate = validatorOf("vscode.executeCompletionItemProvider");
    validate("uri", uri, Uri.isUri(uri));
    validate("position", position, position instanceof Position);
    validate("triggerCharacter", triggerCharacter, isOptional(triggerCharacter, "string"));
    validate("itemResolveCount", itemResolveCount, isOptional(itemResolveCount, "number"));
    return deps.executeCompletionItemProvider(
        await deps.openTextDocument(uri as vscode.Uri),
        position as vscode.Position,
        (triggerCharacter ?? undefined) as string | undefined,
        (itemResolveCount ?? undefined) as number | undefined,
    );
}

async function executeCodeActionProvider(
    deps: IApiCommandsDeps,
    args: readonly unknown[],
): Promise<(vscode.CodeAction | vscode.Command)[]> {
    const [uri, rangeOrSelection, kind, itemResolveCount] = args;
    const validate = validatorOf("vscode.executeCodeActionProvider");
    validate("uri", uri, Uri.isUri(uri));
    validate("rangeOrSelection", rangeOrSelection, rangeOrSelection instanceof Range);
    validate("kind", kind, isOptional(kind, "string"));
    validate("itemResolveCount", itemResolveCount, isOptional(itemResolveCount, "number"));
    return deps.executeCodeActionProvider(
        await deps.openTextDocument(uri as vscode.Uri),
        rangeOrSelection as vscode.Range,
        (kind ?? undefined) as string | undefined,
        (itemResolveCount ?? undefined) as number | undefined,
    );
}

/** Upstream's `ApiCommandArgument.optional()`: `null` passes too. */
function isOptional(value: unknown, type: "string" | "number"): boolean {
    return value === undefined || value === null || typeof value === type;
}

/** Refusal worded exactly as upstream (`ExtHostCommands.registerApiCommand`). */
function validatorOf(command: string): (name: string, value: unknown, valid: boolean) => void {
    return (name, value, valid) => {
        if (valid) return;
        const received =
            typeof value === "object"
                ? JSON.stringify(value, null, "\t")
                : String(value as string | number | boolean | undefined);
        throw new Error(`Invalid argument '${name}' when running '${command}', received: ${received} `);
    };
}
