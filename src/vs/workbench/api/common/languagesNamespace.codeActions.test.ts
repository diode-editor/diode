import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace, type ICodeActionDeps } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import {
    CancellationError,
    CodeAction,
    CodeActionKind,
    Diagnostic,
    Range,
    TextEdit,
    Uri,
    WorkspaceEdit,
} from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function makeCtx(deps?: Partial<ICodeActionDeps>): {
    ctx: IVscodeHostContext;
    stub: IStubRpc;
    languages: typeof vscode.languages;
    appliedEdits: vscode.WorkspaceEdit[];
    appliedMetadata: (vscode.WorkspaceEditMetadata | undefined)[];
    executed: { command: string; args: unknown[] }[];
} {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    const appliedEdits: vscode.WorkspaceEdit[] = [];
    const appliedMetadata: (vscode.WorkspaceEditMetadata | undefined)[] = [];
    const executed: { command: string; args: unknown[] }[] = [];
    const { languages } = createLanguagesNamespace(ctx, {
        applyEdit: (edit, metadata) => {
            appliedEdits.push(edit);
            appliedMetadata.push(metadata);
            return Promise.resolve(true);
        },
        hasCommand: () => Promise.resolve(false),
        executeCommand: (command, ...args) => {
            executed.push({ command, args });
            return Promise.resolve(undefined);
        },
        ...deps,
    });
    // The request document is opened by the mirror (`editor.didOpen`): requests carry no text.
    ctx.documentSync.open({ uri: URI, languageId: "python", version: 1, text: TEXT });
    return { ctx, stub, languages, appliedEdits, appliedMetadata, executed };
}

const URI = "file:///proj/main.py";
const TEXT = "import b\nimport a\nunused()\n";

function requestParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        handle: 0,
        uri: URI,
        languageId: "python",
        version: 1,
        range: { start: { line: 0, character: 0 }, end: { line: 2, character: 8 } },
        ...overrides,
    };
}

function editAction(title: string, kind: string, preferred = false): CodeAction {
    const action = new CodeAction(title, new CodeActionKind(kind));
    const edit = new WorkspaceEdit();
    edit.replace(Uri.parse(URI), new Range(0, 0, 0, 8), title);
    action.edit = edit;
    if (preferred) action.isPreferred = true;
    return action;
}

describe("LanguagesNamespace — registerCodeActionsProvider", () => {
    it("registration is announced to the core with kinds from metadata; dispose removes it once", () => {
        const { stub, languages } = makeCtx();

        const first = languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [],
        } as unknown as vscode.CodeActionProvider);
        languages.registerCodeActionsProvider(
            "python",
            { provideCodeActions: () => [] } as unknown as vscode.CodeActionProvider,
            {
                providedCodeActionKinds: [
                    // A garbage entry without a value is neither counted nor crashes.
                    {} as never,
                    new CodeActionKind("source.organizeImports"),
                    new CodeActionKind("quickfix"),
                ],
            } as never,
        );
        expect(stub.notifies.filter((n) => n.method === "languages.register").map((n) => n.params)).toEqual([
            { handle: 0, kind: "codeActions", selector: [{ language: "python" }], providedCodeActionKinds: [] },
            {
                handle: 1,
                kind: "codeActions",
                selector: [{ language: "python" }],
                providedCodeActionKinds: ["source.organizeImports", "quickfix"],
            },
        ]);

        first.dispose();
        first.dispose(); // a repeated dispose is a no-op
        expect(stub.notifies.filter((n) => n.method === "languages.unregister").map((n) => n.params)).toEqual([
            { handle: 0 },
        ]);
        expect(stub.notifies.filter((n) => n.method === "languages.updateSubscriptions")).toEqual([]);
    });

    it("provide: actions serialize with id/kind/isPreferred, the context carries the range diagnostics", async () => {
        const { stub, languages } = makeCtx();
        const collection = languages.createDiagnosticCollection("lint");
        const inRange = new Diagnostic(new Range(2, 0, 2, 6), "unused call");
        const outOfRange = new Diagnostic(new Range(40, 0, 40, 5), "far away");
        const rangeless = { message: "no range at all" } as unknown as Diagnostic;
        collection.set(
            Uri.parse(URI) as unknown as vscode.Uri,
            [inRange, outOfRange, rangeless] as unknown as vscode.Diagnostic[],
        );
        // A second collection with no entries for our resource is simply skipped.
        const other = languages.createDiagnosticCollection("other");
        other.set(
            Uri.parse("file:///proj/other.py") as unknown as vscode.Uri,
            [new Diagnostic(new Range(0, 0, 0, 1), "elsewhere")] as unknown as vscode.Diagnostic[],
        );

        const contexts: vscode.CodeActionContext[] = [];
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: (doc: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext) => {
                contexts.push(context);
                return [
                    editAction("Fix unused", "quickfix", true),
                    editAction("Sort imports", "source.organizeImports"),
                ];
            },
        } as unknown as vscode.CodeActionProvider);

        const result = (await stub.callRequest("languages.provideCodeActions", requestParams())) as unknown[];
        expect(result).toEqual([
            {
                id: expect.stringMatching(/^\d+\.0$/) as unknown,
                title: "Fix unused",
                kind: "quickfix",
                isPreferred: true,
            },
            { id: expect.stringMatching(/^\d+\.1$/) as unknown, title: "Sort imports", kind: "source.organizeImports" },
        ]);
        // Context: exactly the diagnostic that intersects the range — and
        // the same OBJECT (the client converter's data survives); `only` is unset.
        expect(contexts).toHaveLength(1);
        expect(contexts[0].diagnostics).toHaveLength(1);
        expect(contexts[0].diagnostics[0]).toBe(inRange as unknown as vscode.Diagnostic);
        expect(contexts[0].only).toBeUndefined();
        expect(contexts[0].triggerKind).toBe(1); // Invoke
    });

    it("disabled: the reason is sent as a string; without a string reason the field is omitted", async () => {
        const { stub, languages } = makeCtx();
        const disabled = editAction("Extract", "refactor.extract");
        disabled.disabled = { reason: "Selection is not an expression" };
        const garbage = editAction("Inline", "refactor.inline");
        garbage.disabled = { reason: 42 } as unknown as { reason: string };
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [disabled, garbage],
        } as unknown as vscode.CodeActionProvider);

        const result = (await stub.callRequest("languages.provideCodeActions", requestParams())) as unknown[];
        expect(result).toEqual([
            {
                id: expect.stringMatching(/\.0$/) as unknown,
                title: "Extract",
                kind: "refactor.extract",
                disabled: "Selection is not an expression",
            },
            { id: expect.stringMatching(/\.1$/) as unknown, title: "Inline", kind: "refactor.inline" },
        ]);
    });

    it("intersection bounds: touching the range end is included, starting past the end is not", async () => {
        const { stub, languages } = makeCtx();
        const collection = languages.createDiagnosticCollection("bounds");
        // The request range ends at (2,8): touching exactly at (2,8) is inside,
        // a start at (2,9) on the same line is already outside.
        const touching = new Diagnostic(new Range(2, 8, 2, 12), "touches the end");
        const pastEnd = new Diagnostic(new Range(2, 9, 2, 12), "starts past the end");
        collection.set(Uri.parse(URI) as unknown as vscode.Uri, [touching, pastEnd] as unknown as vscode.Diagnostic[]);

        const contexts: vscode.CodeActionContext[] = [];
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: (d: unknown, r: unknown, context: vscode.CodeActionContext) => {
                contexts.push(context);
                return [];
            },
        } as unknown as vscode.CodeActionProvider);

        await stub.callRequest("languages.provideCodeActions", requestParams());
        expect(contexts[0].diagnostics).toEqual([touching]);
    });

    it("a disposed collection is no longer a code actions context source", async () => {
        const { stub, languages } = makeCtx();
        const kept = languages.createDiagnosticCollection("kept");
        const disposed = languages.createDiagnosticCollection("disposed");
        const keptDiag = new Diagnostic(new Range(2, 0, 2, 6), "kept");
        kept.set(Uri.parse(URI) as unknown as vscode.Uri, [keptDiag] as unknown as vscode.Diagnostic[]);
        disposed.dispose();
        // A late set from a disposed collection (the extension keeps a reference) no longer
        // reaches the context: its storage has been deregistered.
        disposed.set(Uri.parse(URI) as unknown as vscode.Uri, [
            new Diagnostic(new Range(2, 0, 2, 6), "stale") as unknown as vscode.Diagnostic,
        ]);

        const contexts: vscode.CodeActionContext[] = [];
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: (d: unknown, r: unknown, context: vscode.CodeActionContext) => {
                contexts.push(context);
                return [];
            },
        } as unknown as vscode.CodeActionProvider);

        await stub.callRequest("languages.provideCodeActions", requestParams());
        expect(contexts[0].diagnostics).toEqual([keptDiag]);
    });

    it("only: filters by kind hierarchically, drops bare commands, passes CodeActionKind in the context", async () => {
        const { stub, languages } = makeCtx();
        const contexts: vscode.CodeActionContext[] = [];
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: (d: unknown, r: unknown, context: vscode.CodeActionContext) => {
                contexts.push(context);
                return [
                    editAction("Ruff fix all", "source.fixAll.ruff"),
                    editAction("Quick fix", "quickfix"),
                    { title: "Bare command", command: "test.bare" } as unknown as vscode.CodeAction,
                ];
            },
        } as unknown as vscode.CodeActionProvider);

        const result = (await stub.callRequest(
            "languages.provideCodeActions",
            requestParams({ only: "source.fixAll" }),
        )) as { title: string }[];
        expect(result.map((a) => a.title)).toEqual(["Ruff fix all"]);
        expect(contexts[0].only).toBeInstanceOf(CodeActionKind);
        expect(contexts[0].only?.value).toBe("source.fixAll");

        const all = (await stub.callRequest("languages.provideCodeActions", requestParams())) as {
            title: string;
            kind?: string;
        }[];
        expect(all.map((a) => a.title)).toEqual(["Ruff fix all", "Quick fix", "Bare command"]);
        expect(all[2].kind).toBeUndefined();
    });

    it("the provider of the requested handle is called (kind filtering is the core's job); an unknown handle gives []", async () => {
        const { stub, languages, ctx } = makeCtx();
        const organize = vi.fn(() => [editAction("Sort", "source.organizeImports")]);
        const provider = { provideCodeActions: organize } as unknown as vscode.CodeActionProvider;
        const metadata = { providedCodeActionKinds: [new CodeActionKind("source.organizeImports")] } as never;
        languages.registerCodeActionsProvider("python", provider, metadata);
        languages.registerCodeActionsProvider("python", provider, metadata);

        const sorted = (await stub.callRequest("languages.provideCodeActions", requestParams({ only: "source" }))) as {
            title: string;
        }[];
        expect(sorted.map((a) => a.title)).toEqual(["Sort"]);
        expect(organize).toHaveBeenCalledTimes(1);

        // Unknown and missing handle: the provider isn't asked, the document isn't synced.
        const stale = "file:///proj/stale.py";
        expect(
            await stub.callRequest("languages.provideCodeActions", requestParams({ handle: 9, uri: stale })),
        ).toEqual([]);
        expect(ctx.registry.get(Uri.parse(stale))).toBeUndefined();
        expect(await stub.callRequest("languages.provideCodeActions", requestParams({ handle: undefined }))).toEqual(
            [],
        );
        expect(organize).toHaveBeenCalledTimes(1);
    });

    it("a failing or garbage provider gives an empty response; garbage list items are dropped one by one", async () => {
        const { stub, languages } = makeCtx();
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => {
                throw new Error("boom");
            },
        } as unknown as vscode.CodeActionProvider);
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => "junk" as unknown as vscode.CodeAction[],
        } as unknown as vscode.CodeActionProvider);
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [
                editAction("Survivor", "quickfix"),
                null as unknown as vscode.CodeAction,
                // An object without a string title is garbage too and is dropped.
                {} as unknown as vscode.CodeAction,
                { title: 42 } as unknown as vscode.CodeAction,
            ],
        } as unknown as vscode.CodeActionProvider);

        expect(await stub.callRequest("languages.provideCodeActions", requestParams({ handle: 0 }))).toEqual([]);
        expect(await stub.callRequest("languages.provideCodeActions", requestParams({ handle: 1 }))).toEqual([]);
        const result = (await stub.callRequest("languages.provideCodeActions", requestParams({ handle: 2 }))) as {
            title: string;
        }[];
        expect(result.map((a) => a.title)).toEqual(["Survivor"]);
    });
});

describe("LanguagesNamespace — languages.applyCodeAction", () => {
    async function provideAndPick(
        stub: IStubRpc,
        index = 0,
        params: Record<string, unknown> = requestParams(),
    ): Promise<string> {
        const result = (await stub.callRequest("languages.provideCodeActions", params)) as { id: string }[];
        return result[index].id;
    }

    function spyErrors(): unknown[][] {
        return vi.spyOn(console, "error").mockImplementation(() => undefined).mock.calls;
    }

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("edit action: edits go to deps.applyEdit as the same object, the result is reported faithfully", async () => {
        const { stub, languages, appliedEdits, executed } = makeCtx();
        const action = editAction("Fix", "quickfix");
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [action],
        } as unknown as vscode.CodeActionProvider);

        const id = await provideAndPick(stub);
        expect(await stub.callRequest("languages.applyCodeAction", { id })).toBe(true);
        expect(appliedEdits).toHaveLength(1);
        expect(appliedEdits[0]).toBe(action.edit);
        expect(executed).toEqual([]);
    });

    it("action edits are a refactoring (files.refactoring.autoSave), except those applied on save", async () => {
        const { stub, languages, appliedMetadata } = makeCtx();
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [editAction("Fix", "quickfix")],
        } as unknown as vscode.CodeActionProvider);

        expect(await stub.callRequest("languages.applyCodeAction", { id: await provideAndPick(stub) })).toBe(true);
        expect(
            await stub.callRequest("languages.applyCodeAction", { id: await provideAndPick(stub), onSave: true }),
        ).toBe(true);
        // Upstream: `respectAutoSaveConfig: codeActionReason !== ApplyCodeActionReason.OnSave`.
        expect(appliedMetadata).toEqual([{ isRefactoring: true }, { isRefactoring: false }]);
    });

    it("a rejected applyEdit gives false and the action command is NOT run (no half-applied actions)", async () => {
        const { stub, languages, executed } = makeCtx({ applyEdit: () => Promise.resolve(false) });
        const action = editAction("Fix", "quickfix");
        action.command = { title: "after", command: "test.after" } as never;
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [action],
        } as unknown as vscode.CodeActionProvider);

        const id = await provideAndPick(stub);
        expect(await stub.callRequest("languages.applyCodeAction", { id })).toBe(false);
        expect(executed).toEqual([]);
    });

    it("a ready edit is NOT resolved: resolve is called only when there are no edits", async () => {
        const { stub, languages } = makeCtx();
        const resolveSpy = vi.fn((action: vscode.CodeAction) => action);
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [editAction("Ready", "quickfix")],
            resolveCodeAction: resolveSpy,
        } as unknown as vscode.CodeActionProvider);

        const id = await provideAndPick(stub);
        expect(await stub.callRequest("languages.applyCodeAction", { id })).toBe(true);
        expect(resolveSpy).not.toHaveBeenCalled();
    });

    it("edits applied but the action command failed gives false (the action did not complete)", async () => {
        const errors = spyErrors();
        const { stub, languages, appliedEdits } = makeCtx({
            executeCommand: () => Promise.reject(new Error("late boom")),
        });
        const action = editAction("Edit then command", "quickfix");
        action.command = { title: "after", command: "test.after" } as never;
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [action],
        } as unknown as vscode.CodeActionProvider);

        const id = await provideAndPick(stub);
        expect(await stub.callRequest("languages.applyCodeAction", { id })).toBe(false);
        expect(appliedEdits).toHaveLength(1); // the edits landed before the command failed
        expect(errors).toHaveLength(1);
    });

    it("resolve returning a NEW object replaces the action (the original is not mutated)", async () => {
        const { stub, languages, appliedEdits } = makeCtx();
        const lazy = new CodeAction("Fresh resolve", new CodeActionKind("source.fixAll"));
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [lazy],
            resolveCodeAction: () => {
                // The server may return a NEW object instead of mutating the original —
                // that one is what must be applied.
                const fresh = new CodeAction("Fresh resolve", new CodeActionKind("source.fixAll"));
                const edit = new WorkspaceEdit();
                edit.replace(Uri.parse(URI), new Range(0, 0, 0, 3), "new");
                fresh.edit = edit;
                return fresh;
            },
        } as unknown as vscode.CodeActionProvider);

        const id = await provideAndPick(stub);
        expect(await stub.callRequest("languages.applyCodeAction", { id })).toBe(true);
        expect(appliedEdits).toHaveLength(1);
        expect(lazy.edit).toBeUndefined(); // the original object stays untouched
    });

    it("lazy resolve: the edit is resolved on THE SAME action object", async () => {
        const { stub, languages, appliedEdits } = makeCtx();
        const lazy = new CodeAction("Lazy fix", new CodeActionKind("source.fixAll"));
        const resolvedWith: unknown[] = [];
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [lazy],
            resolveCodeAction: (action: vscode.CodeAction) => {
                resolvedWith.push(action);
                const edit = new WorkspaceEdit();
                edit.replace(Uri.parse(URI), new Range(1, 0, 1, 8), "resolved");
                (action as { edit?: unknown }).edit = edit;
                return action;
            },
        } as unknown as vscode.CodeActionProvider);

        const id = await provideAndPick(stub);
        expect(await stub.callRequest("languages.applyCodeAction", { id })).toBe(true);
        expect(resolvedWith).toEqual([lazy]);
        expect(appliedEdits).toHaveLength(1);
    });

    it("commands: for a CodeAction after the edits, for a bare vscode.Command right away; a command failure gives false", async () => {
        const { stub, languages, executed } = makeCtx();
        const withCommand = new CodeAction("Run tool", new CodeActionKind("quickfix"));
        withCommand.command = { title: "run", command: "test.run", arguments: [1, "a"] } as never;
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [
                withCommand,
                { title: "Bare", command: "test.bare", arguments: ["z"] } as unknown as vscode.CodeAction,
            ],
        } as unknown as vscode.CodeActionProvider);

        const first = await provideAndPick(stub, 0);
        expect(await stub.callRequest("languages.applyCodeAction", { id: first })).toBe(true);
        const second = await provideAndPick(stub, 1);
        expect(await stub.callRequest("languages.applyCodeAction", { id: second })).toBe(true);
        expect(executed).toEqual([
            { command: "test.run", args: [1, "a"] },
            { command: "test.bare", args: ["z"] },
        ]);

        // A bare command WITHOUT arguments runs with an empty list, not garbage.
        const noArgs = makeCtx();
        noArgs.languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [
                { title: "Bare no args", command: "test.noargs" } as unknown as vscode.CodeAction,
            ],
        } as unknown as vscode.CodeActionProvider);
        const noArgsId = await provideAndPick(noArgs.stub);
        expect(await noArgs.stub.callRequest("languages.applyCodeAction", { id: noArgsId })).toBe(true);
        expect(noArgs.executed).toEqual([{ command: "test.noargs", args: [] }]);

        const errors = spyErrors();
        const boom = new Error("cmd boom");
        const failing = makeCtx({ executeCommand: () => Promise.reject(boom) });
        const failingAction = new CodeAction("Broken cmd", new CodeActionKind("quickfix"));
        failingAction.command = { title: "run", command: "test.broken" } as never;
        failing.ctx.owner.runAs("pub.fixer", () =>
            failing.languages.registerCodeActionsProvider("python", {
                provideCodeActions: () => [
                    failingAction,
                    { title: "Bare", command: "test.bare" } as unknown as vscode.CodeAction,
                ],
            } as unknown as vscode.CodeActionProvider),
        );
        // A command failure is false for both a CodeAction command and a bare vscode.Command;
        // not silent: a line in stderr with the id of the provider's owner extension.
        const brokenAction = await provideAndPick(failing.stub, 0);
        expect(await failing.stub.callRequest("languages.applyCodeAction", { id: brokenAction })).toBe(false);
        const brokenBare = await provideAndPick(failing.stub, 1);
        expect(await failing.stub.callRequest("languages.applyCodeAction", { id: brokenBare })).toBe(false);
        expect(errors).toEqual([
            [`[ext-host] [pub.fixer] applyCodeAction command "test.broken" failed: ${String(boom.stack)}`],
            [`[ext-host] [pub.fixer] applyCodeAction command "test.bare" failed: ${String(boom.stack)}`],
        ]);
        errors.length = 0;

        // A cancelled command is a regular outcome, not a failure: false, but stderr stays silent.
        const cancelled = makeCtx({ executeCommand: () => Promise.reject(new CancellationError()) });
        cancelled.languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [{ title: "Bare", command: "test.cancel" } as unknown as vscode.CodeAction],
        } as unknown as vscode.CodeActionProvider);
        const cancelledId = await provideAndPick(cancelled.stub);
        expect(await cancelled.stub.callRequest("languages.applyCodeAction", { id: cancelledId })).toBe(false);
        expect(errors).toEqual([]);

        // A Command object without a string command has nothing to apply: false.
        const malformed = makeCtx();
        const noName = new CodeAction("No command name", new CodeActionKind("quickfix"));
        noName.command = { title: "?" } as never;
        malformed.languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [noName],
        } as unknown as vscode.CodeActionProvider);
        const malformedId = await provideAndPick(malformed.stub);
        expect(await malformed.stub.callRequest("languages.applyCodeAction", { id: malformedId })).toBe(false);
        expect(malformed.executed).toEqual([]);
    });

    it("a failing resolve does not break apply: the command path remains; a fully empty action gives false", async () => {
        const { stub, languages, executed } = makeCtx();
        const broken = new CodeAction("Broken resolve", new CodeActionKind("quickfix"));
        broken.command = { title: "fallback", command: "test.fallback" } as never;
        const empty = new CodeAction("Empty", new CodeActionKind("quickfix"));
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [broken, empty],
            resolveCodeAction: () => {
                throw new Error("resolve boom");
            },
        } as unknown as vscode.CodeActionProvider);

        const first = await provideAndPick(stub, 0);
        expect(await stub.callRequest("languages.applyCodeAction", { id: first })).toBe(true);
        expect(executed).toEqual([{ command: "test.fallback", args: [] }]);

        // Neither edit nor command (and resolve is broken): nothing to apply.
        const second = await provideAndPick(stub, 1);
        expect(await stub.callRequest("languages.applyCodeAction", { id: second })).toBe(false);
    });

    it("default deps (namespace without wiring) refuse: edits give false, the command rejects", async () => {
        const errors = spyErrors();
        const stub = makeStubRpc();
        const registry = new DocumentRegistry();
        const documentSync = new DocumentSyncTracker(registry);
        documentSync.open({ uri: URI, languageId: "python", version: 1, text: TEXT });
        const { languages } = createLanguagesNamespace({
            rpc: stub.rpc,
            registry,
            documentSync,
            configStore: new WorkspaceConfigStore(),
            disk: createNodeExtHostDisk(),
            owner: new ExtensionOwner(),
        });
        const withEdit = editAction("Fix", "quickfix");
        const withCommand = { title: "Bare", command: "test.bare" } as unknown as vscode.CodeAction;
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [withEdit, withCommand],
        } as unknown as vscode.CodeActionProvider);

        const result = (await stub.callRequest("languages.provideCodeActions", requestParams())) as { id: string }[];
        expect(await stub.callRequest("languages.applyCodeAction", { id: result[0].id })).toBe(false);
        expect(await stub.callRequest("languages.applyCodeAction", { id: result[1].id })).toBe(false);
        // A registration outside an overlay gives a line without an id; the refusal reason shows in stderr.
        expect(errors).toHaveLength(1);
        expect(errors[0]).toEqual([
            expect.stringMatching(
                /^\[ext-host\] applyCodeAction command "test\.bare" failed: Error: commands bridge is not wired\n/,
            ) as unknown,
        ]);
    });

    it("bare params (no languageId) use the mirror document; the language is not overwritten", async () => {
        const { stub, languages } = makeCtx();
        const seen: { text: string; languageId: string }[] = [];
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: (doc: vscode.TextDocument) => {
                seen.push({ text: doc.getText(), languageId: doc.languageId });
                return [];
            },
        } as unknown as vscode.CodeActionProvider);
        expect(
            await stub.callRequest("languages.provideCodeActions", {
                handle: 0,
                uri: URI,
                version: 1,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            }),
        ).toEqual([]);
        expect(seen).toEqual([{ text: TEXT, languageId: "python" }]);
    });

    it("an unopened, stale, ahead-of-mirror or unversioned document gives [] without calling the provider", async () => {
        const { stub, languages, ctx } = makeCtx();
        const provide = vi.fn(() => [editAction("Fix", "quickfix")]);
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: provide,
        } as unknown as vscode.CodeActionProvider);
        ctx.documentSync.change({
            uri: URI,
            version: 2,
            changes: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "#\n" }],
        });
        const unknown = "file:///proj/unknown.py";
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            for (const overrides of [{ uri: unknown }, { version: 1 }, { version: 3 }, { version: undefined }]) {
                expect(await stub.callRequest("languages.provideCodeActions", requestParams(overrides))).toEqual([]);
            }
        } finally {
            warn.mockRestore();
        }
        expect(ctx.registry.get(Uri.parse(unknown))).toBeUndefined();
        expect(provide).not.toHaveBeenCalled();
        // Current version: the provider is called on the mirror text after the edit.
        expect(await stub.callRequest("languages.provideCodeActions", requestParams({ version: 2 }))).toHaveLength(1);
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it("resolve returning nothing does not replace the action; the command path remains", async () => {
        const { stub, languages, executed } = makeCtx();
        const action = new CodeAction("Void resolve", new CodeActionKind("quickfix"));
        action.command = { title: "run", command: "test.void" } as never;
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [action],
            resolveCodeAction: () => undefined,
        } as unknown as vscode.CodeActionProvider);
        const id = await provideAndPick(stub);
        expect(await stub.callRequest("languages.applyCodeAction", { id })).toBe(true);
        expect(executed).toEqual([{ command: "test.void", args: [] }]);
    });

    it("a stale id and garbage params give false", async () => {
        const { stub, languages } = makeCtx();
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [editAction("Fix", "quickfix")],
        } as unknown as vscode.CodeActionProvider);

        expect(await stub.callRequest("languages.applyCodeAction", { id: "999.0" })).toBe(false);
        expect(await stub.callRequest("languages.applyCodeAction", {})).toBe(false);
        expect(await stub.callRequest("languages.applyCodeAction", { id: 5 })).toBe(false);

        // Cache eviction: two new requests push out the first one's bucket.
        const stale = await provideAndPick(stub);
        await provideAndPick(stub);
        await provideAndPick(stub);
        expect(await stub.callRequest("languages.applyCodeAction", { id: stale })).toBe(false);
    });

    it("the cache is per provider: a menu from three providers applies the fastest one's action", async () => {
        // Regression "Fix with Supermaven → Code action failed": the core asks
        // each provider in a separate request, and a shared cache depth of 2
        // evicted the first responder's bucket while the others were answering.
        const { stub, languages, executed } = makeCtx();
        for (const title of ["Fast", "Second", "Third"]) {
            languages.registerCodeActionsProvider("python", {
                provideCodeActions: () => [{ title, command: `test.${title}` }],
            } as unknown as vscode.CodeActionProvider);
        }

        const menu = await Promise.all([0, 1, 2].map((handle) => provideAndPick(stub, 0, requestParams({ handle }))));
        expect(await stub.callRequest("languages.applyCodeAction", { id: menu[0] })).toBe(true);
        expect(executed).toEqual([{ command: "test.Fast", args: [] }]);

        // Each provider has its own depth: two new answers from ONE provider evict its
        // old bucket but leave the neighbors' buckets alone.
        await provideAndPick(stub, 0, requestParams({ handle: 0 }));
        await provideAndPick(stub, 0, requestParams({ handle: 0 }));
        expect(await stub.callRequest("languages.applyCodeAction", { id: menu[0] })).toBe(false);
        expect(await stub.callRequest("languages.applyCodeAction", { id: menu[1] })).toBe(true);
        expect(executed.map((e) => e.command)).toEqual(["test.Fast", "test.Second"]);
    });

    it("a disposed provider takes its cache with it: its action no longer applies, its neighbor's does", async () => {
        const { stub, languages, executed } = makeCtx();
        const removed = languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [{ title: "Gone", command: "test.gone" }],
        } as unknown as vscode.CodeActionProvider);
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [{ title: "Kept", command: "test.kept" }],
        } as unknown as vscode.CodeActionProvider);
        const gone = await provideAndPick(stub, 0, requestParams({ handle: 0 }));
        const kept = await provideAndPick(stub, 0, requestParams({ handle: 1 }));

        removed.dispose();
        expect(await stub.callRequest("languages.applyCodeAction", { id: gone })).toBe(false);
        expect(await stub.callRequest("languages.applyCodeAction", { id: kept })).toBe(true);
        expect(executed).toEqual([{ command: "test.kept", args: [] }]);
    });
});
