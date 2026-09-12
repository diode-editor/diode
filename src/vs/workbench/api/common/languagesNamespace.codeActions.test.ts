import type * as vscode from "vscode";

import { describe, expect, it, vi } from "vitest";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace, type ICodeActionDeps } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { CodeAction, CodeActionKind, Diagnostic, Range, TextEdit, Uri, WorkspaceEdit } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

// Субпроцессная сторона code actions (#196): контекст собирается из локальных
// DiagnosticCollection, действия кэшируются для apply/resolve, правки ложатся
// через deps.applyEdit (существующий путь workspace.applyEdit), команды — через
// deps.executeCommand.

function makeCtx(deps?: Partial<ICodeActionDeps>): {
    ctx: IVscodeHostContext;
    stub: IStubRpc;
    languages: typeof vscode.languages;
    appliedEdits: vscode.WorkspaceEdit[];
    executed: { command: string; args: unknown[] }[];
} {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
    };
    const appliedEdits: vscode.WorkspaceEdit[] = [];
    const executed: { command: string; args: unknown[] }[] = [];
    const { languages } = createLanguagesNamespace(ctx, {
        applyEdit: (edit) => {
            appliedEdits.push(edit);
            return Promise.resolve(true);
        },
        executeCommand: (command, ...args) => {
            executed.push({ command, args });
            return Promise.resolve(undefined);
        },
        ...deps,
    });
    return { ctx, stub, languages, appliedEdits, executed };
}

const URI = "file:///proj/main.py";

function requestParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        uri: URI,
        languageId: "python",
        text: "import b\nimport a\nunused()\n",
        range: { startLine: 0, startCharacter: 0, endLine: 2, endCharacter: 8 },
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
    it("подписка сигналится на переходах 0↔1 (hasCodeActionsProviders)", () => {
        const { stub, languages } = makeCtx();
        const flags = (): unknown[] =>
            stub.notifies
                .filter((n) => n.method === "languages.updateSubscriptions")
                .map((n) => (n.params as { hasCodeActionsProviders?: unknown }).hasCodeActionsProviders);

        const first = languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [],
        } as unknown as vscode.CodeActionProvider);
        expect(flags()).toEqual([true]);
        const second = languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [],
        } as unknown as vscode.CodeActionProvider);
        second.dispose();
        second.dispose(); // повторный dispose — no-op
        expect(flags()).toEqual([true]);
        first.dispose();
        expect(flags()).toEqual([true, false]);
    });

    it("provide: действия сериализуются с id/kind/isPreferred, контекст несёт диагностики диапазона", async () => {
        const { stub, languages } = makeCtx();
        const collection = languages.createDiagnosticCollection("lint");
        const inRange = new Diagnostic(new Range(2, 0, 2, 6), "unused call");
        const outOfRange = new Diagnostic(new Range(40, 0, 40, 5), "far away");
        const rangeless = { message: "no range at all" } as unknown as Diagnostic;
        collection.set(Uri.parse(URI) as unknown as vscode.Uri, [
            inRange,
            outOfRange,
            rangeless,
        ] as unknown as vscode.Diagnostic[]);
        // Вторая коллекция без записей по нашему ресурсу — просто пропускается.
        const other = languages.createDiagnosticCollection("other");
        other.set(Uri.parse("file:///proj/other.py") as unknown as vscode.Uri, [
            new Diagnostic(new Range(0, 0, 0, 1), "elsewhere"),
        ] as unknown as vscode.Diagnostic[]);

        const contexts: vscode.CodeActionContext[] = [];
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: (doc: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext) => {
                contexts.push(context);
                return [editAction("Fix unused", "quickfix", true), editAction("Sort imports", "source.organizeImports")];
            },
        } as unknown as vscode.CodeActionProvider);

        const result = (await stub.callRequest("languages.provideCodeActions", requestParams())) as unknown[];
        expect(result).toEqual([
            { id: expect.stringMatching(/^\d+\.0$/), title: "Fix unused", kind: "quickfix", isPreferred: true },
            { id: expect.stringMatching(/^\d+\.1$/), title: "Sort imports", kind: "source.organizeImports" },
        ]);
        // Контекст: ровно та диагностика, что пересекается с диапазоном, — и
        // тот же ОБЪЕКТ (данные конвертера клиента выживают), без only.
        expect(contexts).toHaveLength(1);
        expect(contexts[0].diagnostics).toHaveLength(1);
        expect(contexts[0].diagnostics[0]).toBe(inRange as unknown as vscode.Diagnostic);
        expect(contexts[0].only).toBeUndefined();
        expect(contexts[0].triggerKind).toBe(1); // Invoke — дефолт без поля

        // Automatic (лампочка) — только явной двойкой; мусор откатывается в Invoke.
        await stub.callRequest("languages.provideCodeActions", requestParams({ triggerKind: 2 }));
        expect(contexts[1].triggerKind).toBe(2);
        await stub.callRequest("languages.provideCodeActions", requestParams({ triggerKind: "2" }));
        expect(contexts[2].triggerKind).toBe(1);
    });

    it("границы пересечения: касание конца диапазона включается, старт за концом — нет", async () => {
        const { stub, languages } = makeCtx();
        const collection = languages.createDiagnosticCollection("bounds");
        // Диапазон запроса кончается в (2,8): касание ровно в (2,8) — внутри,
        // старт в (2,9) на той же строке — уже снаружи.
        const touching = new Diagnostic(new Range(2, 8, 2, 12), "touches the end");
        const pastEnd = new Diagnostic(new Range(2, 9, 2, 12), "starts past the end");
        collection.set(Uri.parse(URI) as unknown as vscode.Uri, [
            touching,
            pastEnd,
        ] as unknown as vscode.Diagnostic[]);

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

    it("only: фильтрует по виду иерархически, голые команды отбрасывает, в контекст едет CodeActionKind", async () => {
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

        // Без only голая команда проходит.
        const all = (await stub.callRequest("languages.provideCodeActions", requestParams())) as {
            title: string;
            kind?: string;
        }[];
        expect(all.map((a) => a.title)).toEqual(["Ruff fix all", "Quick fix", "Bare command"]);
        expect(all[2].kind).toBeUndefined();
    });

    it("providedKinds отсекают провайдера без вызова; матч без действий — [], нет провайдера — null", async () => {
        const { stub, languages } = makeCtx();
        const organize = vi.fn(() => [editAction("Sort", "source.organizeImports")]);
        languages.registerCodeActionsProvider(
            "python",
            { provideCodeActions: organize } as unknown as vscode.CodeActionProvider,
            { providedCodeActionKinds: [new CodeActionKind("source.organizeImports")] } as never,
        );

        // only другого вида: провайдер не вызван, но ответ [] (провайдер под документ ЕСТЬ).
        const filtered = await stub.callRequest(
            "languages.provideCodeActions",
            requestParams({ only: "source.fixAll" }),
        );
        expect(filtered).toEqual([]);
        expect(organize).not.toHaveBeenCalled();

        // Чужой язык — null («нет провайдера»).
        expect(
            await stub.callRequest("languages.provideCodeActions", requestParams({ languageId: "markdown" })),
        ).toBeNull();

        // Пересекающийся only — провайдер вызван.
        await stub.callRequest("languages.provideCodeActions", requestParams({ only: "source" }));
        expect(organize).toHaveBeenCalledTimes(1);
    });

    it("метаданные: достаточно ОДНОГО пересекающегося вида, мусорные виды игнорируются", async () => {
        const { stub, languages } = makeCtx();
        const provide = vi.fn(() => [editAction("Sort", "source.organizeImports")]);
        languages.registerCodeActionsProvider(
            "python",
            { provideCodeActions: provide } as unknown as vscode.CodeActionProvider,
            {
                providedCodeActionKinds: [
                    // Мусорная запись без value — не считается и не роняет.
                    {} as never,
                    new CodeActionKind("source.organizeImports"),
                    new CodeActionKind("quickfix"),
                ],
            } as never,
        );

        // Пересекается только ОДИН из видов — провайдер обязан быть спрошен.
        const result = (await stub.callRequest(
            "languages.provideCodeActions",
            requestParams({ only: "source.organizeImports" }),
        )) as { title: string }[];
        expect(result.map((a) => a.title)).toEqual(["Sort"]);
        expect(provide).toHaveBeenCalledTimes(1);

        // Без only метаданные вообще не участвуют — провайдер спрошен как есть.
        const unfiltered = (await stub.callRequest("languages.provideCodeActions", requestParams())) as {
            title: string;
        }[];
        expect(unfiltered.map((a) => a.title)).toEqual(["Sort"]);
        expect(provide).toHaveBeenCalledTimes(2);
    });

    it("сбойный или мусорный провайдер пропускается, второй отвечает", async () => {
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
                // Объект без строкового title — тоже мусор, отбрасывается.
                {} as unknown as vscode.CodeAction,
                { title: 42 } as unknown as vscode.CodeAction,
            ],
        } as unknown as vscode.CodeActionProvider);

        const result = (await stub.callRequest("languages.provideCodeActions", requestParams())) as {
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

    it("edit-действие: правки уходят в deps.applyEdit тем же объектом, ответ честный", async () => {
        const { stub, languages, appliedEdits, executed } = makeCtx();
        const action = editAction("Fix", "quickfix");
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [action],
        } as unknown as vscode.CodeActionProvider);

        const id = await provideAndPick(stub);
        expect(await stub.callRequest("languages.applyCodeAction", { id })).toBe(true);
        expect(appliedEdits).toHaveLength(1);
        expect(appliedEdits[0]).toBe(action.edit as unknown as vscode.WorkspaceEdit);
        expect(executed).toEqual([]);
    });

    it("отказ applyEdit — false, команда действия НЕ исполняется («наполовину» нельзя)", async () => {
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

    it("готовый edit НЕ дорезолвливается: resolve зовётся только когда правок нет", async () => {
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

    it("правки легли, но команда действия упала — false (действие не завершилось)", async () => {
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
        expect(appliedEdits).toHaveLength(1); // правки успели лечь до сбоя команды
    });

    it("resolve, вернувший НОВЫЙ объект, подменяет действие (исходное не мутируется)", async () => {
        const { stub, languages, appliedEdits } = makeCtx();
        const lazy = new CodeAction("Fresh resolve", new CodeActionKind("source.fixAll"));
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [lazy],
            resolveCodeAction: () => {
                // Сервер вправе вернуть НОВЫЙ объект вместо мутации исходного —
                // применяться обязан именно он.
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
        expect(lazy.edit).toBeUndefined(); // исходный объект остался нетронутым
    });

    it("ленивый resolve: edit дорезолвливается ТЕМ ЖЕ объектом действия", async () => {
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

    it("команды: у CodeAction — после правок, у голой vscode.Command — сразу; сбой команды — false", async () => {
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

        // Голая команда БЕЗ arguments — исполняется с пустым списком, не с мусором.
        const noArgs = makeCtx();
        noArgs.languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [{ title: "Bare no args", command: "test.noargs" } as unknown as vscode.CodeAction],
        } as unknown as vscode.CodeActionProvider);
        const noArgsId = await provideAndPick(noArgs.stub);
        expect(await noArgs.stub.callRequest("languages.applyCodeAction", { id: noArgsId })).toBe(true);
        expect(noArgs.executed).toEqual([{ command: "test.noargs", args: [] }]);

        const failing = makeCtx({ executeCommand: () => Promise.reject(new Error("cmd boom")) });
        const failingAction = new CodeAction("Broken cmd", new CodeActionKind("quickfix"));
        failingAction.command = { title: "run", command: "test.broken" } as never;
        failing.languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [
                failingAction,
                { title: "Bare", command: "test.bare" } as unknown as vscode.CodeAction,
            ],
        } as unknown as vscode.CodeActionProvider);
        // Сбой команды — false и у CodeAction-команды, и у голой vscode.Command.
        const brokenAction = await provideAndPick(failing.stub, 0);
        expect(await failing.stub.callRequest("languages.applyCodeAction", { id: brokenAction })).toBe(false);
        const brokenBare = await provideAndPick(failing.stub, 1);
        expect(await failing.stub.callRequest("languages.applyCodeAction", { id: brokenBare })).toBe(false);

        // Command-объект без строкового command — применять нечего: false.
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

    it("сбойный resolve не роняет apply: остаётся command-путь; совсем пустое действие — false", async () => {
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

        // Ни edit, ни command (и resolve сломан) — применять нечего.
        const second = await provideAndPick(stub, 1);
        expect(await stub.callRequest("languages.applyCodeAction", { id: second })).toBe(false);
    });

    it("дефолтные deps (namespace без проводки) честно отказывают: правки false, команда reject", async () => {
        const stub = makeStubRpc();
        const registry = new DocumentRegistry();
        const { languages } = createLanguagesNamespace({
            rpc: stub.rpc,
            registry,
            documentSync: new DocumentSyncTracker(registry),
            configStore: new WorkspaceConfigStore(),
        });
        const withEdit = editAction("Fix", "quickfix");
        const withCommand = { title: "Bare", command: "test.bare" } as unknown as vscode.CodeAction;
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [withEdit, withCommand],
        } as unknown as vscode.CodeActionProvider);

        const result = (await stub.callRequest("languages.provideCodeActions", requestParams())) as { id: string }[];
        expect(await stub.callRequest("languages.applyCodeAction", { id: result[0].id })).toBe(false);
        expect(await stub.callRequest("languages.applyCodeAction", { id: result[1].id })).toBe(false);
    });

    it("голые параметры (без languageId/text) — документ на дефолтном языке с пустым текстом", async () => {
        const { stub, languages } = makeCtx();
        const texts: string[] = [];
        languages.registerCodeActionsProvider("plaintext", {
            provideCodeActions: (doc: vscode.TextDocument) => {
                texts.push(doc.getText());
                return [];
            },
        } as unknown as vscode.CodeActionProvider);
        expect(
            await stub.callRequest("languages.provideCodeActions", {
                uri: URI,
                range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 },
            }),
        ).toEqual([]);
        expect(texts).toEqual([""]);
    });

    it("resolve, вернувший пустоту, не подменяет действие — остаётся command-путь", async () => {
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

    it("протухший id и мусорные параметры — честный false", async () => {
        const { stub, languages } = makeCtx();
        languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [editAction("Fix", "quickfix")],
        } as unknown as vscode.CodeActionProvider);

        expect(await stub.callRequest("languages.applyCodeAction", { id: "999.0" })).toBe(false);
        expect(await stub.callRequest("languages.applyCodeAction", {})).toBe(false);
        expect(await stub.callRequest("languages.applyCodeAction", { id: 5 })).toBe(false);

        // Вытеснение кэша: два новых запроса выталкивают ведро первого.
        const stale = await provideAndPick(stub);
        await provideAndPick(stub);
        await provideAndPick(stub);
        expect(await stub.callRequest("languages.applyCodeAction", { id: stale })).toBe(false);
    });
});
