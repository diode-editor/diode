import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";
import { Emitter } from "../../../base/common/event.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { CodeLens, Position, Range, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const URI = "file:///proj/main.ts";
const RANGE = new Range(new Position(1, 2), new Position(1, 5));
const WIRE_RANGE = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } };

interface IContext {
    readonly stub: IStubRpc;
    readonly languages: typeof vscode.languages;
    readonly owner: ExtensionOwner;
    readonly execute: ReturnType<typeof vi.fn>;
}

function makeCtx(known: (id: string) => boolean = () => true): IContext {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const owner = new ExtensionOwner();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry, () => undefined),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner,
    };
    const execute = vi.fn((_id: string, ..._args: unknown[]): Promise<unknown> => Promise.resolve("ignored"));
    const { languages } = createLanguagesNamespace(ctx, {
        applyEdit: () => Promise.resolve(false),
        executeCommand: execute,
        hasCommand: (id) => Promise.resolve(known(id)),
    });
    ctx.documentSync.open({ uri: URI, languageId: "typescript", version: 1, text: "a\nb\n" });
    return { stub, languages, owner, execute };
}

const lens = (command?: vscode.Command, range: Range = RANGE): vscode.CodeLens =>
    new CodeLens(range, command) as unknown as vscode.CodeLens;

function provider(
    answer: () => unknown,
    resolve?: (lens: vscode.CodeLens, token: vscode.CancellationToken) => unknown,
): vscode.CodeLensProvider {
    return {
        provideCodeLenses: () => answer() as vscode.CodeLens[],
        ...(resolve === undefined ? {} : { resolveCodeLens: (item, token) => resolve(item, token) as vscode.CodeLens }),
    };
}

interface IWireList {
    readonly cacheId: number;
    readonly lenses: readonly { readonly cacheId: readonly [number, number] }[];
}

const provide = (stub: IStubRpc, token?: CancellationTokenSource): Promise<unknown> =>
    stub.callRequest(
        "languages.provideCodeLenses",
        { handle: 0, uri: URI, languageId: "typescript", version: 1 },
        token?.token,
    );

async function provideList(stub: IStubRpc): Promise<IWireList> {
    const list = await provide(stub);
    if (list === null) throw new Error("no lenses");
    return list as IWireList;
}

const address = (cacheId: readonly [number, number], handle = 0): { handle: number; cacheId: typeof cacheId } => ({
    handle,
    cacheId,
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("LanguagesNamespace — registerCodeLensProvider", () => {
    it("[api:languages.registerCodeLensProvider] declared as kind codeLens, dispose removes it once", () => {
        const { stub, languages } = makeCtx();
        const registration = languages.registerCodeLensProvider(
            { language: "typescript" },
            provider(() => []),
        );
        registration.dispose();
        registration.dispose();
        expect(stub.notifies.filter((n) => n.method.startsWith("languages."))).toEqual([
            {
                method: "languages.register",
                params: { handle: 0, kind: "codeLens", selector: [{ language: "typescript" }] },
            },
            { method: "languages.unregister", params: { handle: 0 } },
        ]);
    });

    it("[api:CodeLensProvider.onDidChangeCodeLenses] the event is declared and notified with the handle, until dispose", () => {
        const { stub, languages } = makeCtx();
        const changed = new Emitter<void>();
        const registration = languages.registerCodeLensProvider("typescript", {
            onDidChangeCodeLenses: changed.event,
            provideCodeLenses: () => [],
        });
        expect(stub.notifies.at(0)?.params).toMatchObject({ handle: 0, hasOnDidChange: true });
        changed.fire();
        expect(stub.notifies.at(-1)).toEqual({ method: "languages.didChangeCodeLenses", params: { handle: 0 } });
        registration.dispose();
        const count = stub.notifies.length;
        changed.fire();
        expect(stub.notifies).toHaveLength(count);
    });

    it("without the event nothing is declared", () => {
        const { stub, languages } = makeCtx();
        languages.registerCodeLensProvider(
            "typescript",
            provider(() => []),
        );
        expect(stub.notifies.at(0)?.params).not.toHaveProperty("hasOnDidChange");
    });
});

describe("languages.provideCodeLenses", () => {
    it("[api:CodeLensProvider.provideCodeLenses] the wire carries the address, range and title, not the arguments", async () => {
        const { stub, languages } = makeCtx();
        languages.registerCodeLensProvider(
            "typescript",
            provider(() => [
                lens({ command: "run", title: "Run", tooltip: "Runs", arguments: [Uri.parse(URI)] }),
                lens(),
            ]),
        );
        const list = await provideList(stub);
        expect(list).toEqual({
            cacheId: list.cacheId,
            lenses: [
                {
                    cacheId: [list.cacheId, 0],
                    range: WIRE_RANGE,
                    command: { id: "run", title: "Run", tooltip: "Runs" },
                },
                { cacheId: [list.cacheId, 1], range: WIRE_RANGE },
            ],
        });
    });

    it("each answer is its own session", async () => {
        const { stub, languages } = makeCtx();
        languages.registerCodeLensProvider(
            "typescript",
            provider(() => [lens()]),
        );
        const first = await provideList(stub);
        const second = await provideList(stub);
        expect(second.cacheId).not.toBe(first.cacheId);
    });

    it("a command without an id stays a label, one without a title is no command", async () => {
        const { stub, languages } = makeCtx();
        languages.registerCodeLensProvider(
            "typescript",
            provider(() => [
                lens({ title: "label" } as vscode.Command),
                lens({ command: "x" } as vscode.Command),
                lens({ command: "x", title: "t", tooltip: 1 } as unknown as vscode.Command),
            ]),
        );
        const list = await provideList(stub);
        expect(list.lenses).toEqual([
            { cacheId: [list.cacheId, 0], range: WIRE_RANGE, command: { id: "", title: "label" } },
            { cacheId: [list.cacheId, 1], range: WIRE_RANGE },
            { cacheId: [list.cacheId, 2], range: WIRE_RANGE, command: { id: "x", title: "t" } },
        ]);
    });

    it("a lens without a range is dropped with a warning naming the extension, the indexes stay", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { stub, languages, owner } = makeCtx();
        owner.runAs("pub.ext", () =>
            languages.registerCodeLensProvider(
                "typescript",
                provider(() => [{ command: { command: "x", title: "t" } }, null, lens()]),
            ),
        );
        const list = await provideList(stub);
        expect(list.lenses.map((item) => item.cacheId)).toEqual([[list.cacheId, 2]]);
        expect(warn).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenCalledWith("[ext-host] [pub.ext] INVALID code lens, range is not defined");
    });

    it.each([
        ["an empty array", () => []],
        ["undefined", () => undefined],
        ["null", () => null],
        ["not an array", () => ({ length: 1 })],
    ])("%s is null", async (_name, answer) => {
        const { stub, languages } = makeCtx();
        languages.registerCodeLensProvider("typescript", provider(answer));
        expect(await provide(stub)).toBeNull();
    });

    it("only lenses without a range: null, and no session is left", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { stub, languages } = makeCtx();
        languages.registerCodeLensProvider(
            "typescript",
            provider(() => [{}]),
        );
        expect(await provide(stub)).toBeNull();
        expect(await stub.callRequest("languages.resolveCodeLens", address([1, 0]))).toBeNull();
    });

    it("a failure is null and is logged with the extension", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { stub, languages, owner } = makeCtx();
        owner.runAs("pub.ext", () =>
            languages.registerCodeLensProvider(
                "typescript",
                provider(() => {
                    throw new Error("lenses exploded");
                }),
            ),
        );
        expect(await provide(stub)).toBeNull();
        expect(error).toHaveBeenCalledWith(
            expect.stringContaining("[ext-host] [pub.ext] provideCodeLenses failed: Error: lenses exploded"),
        );
    });

    it("unknown handle or a document that is not synced: null, the provider is not asked", async () => {
        const { stub, languages } = makeCtx();
        const answer = vi.fn(() => [lens()]);
        languages.registerCodeLensProvider("typescript", provider(answer));
        expect(
            await stub.callRequest("languages.provideCodeLenses", {
                handle: 7,
                uri: URI,
                languageId: "typescript",
                version: 1,
            }),
        ).toBeNull();
        expect(
            await stub.callRequest("languages.provideCodeLenses", {
                handle: 0,
                uri: "file:///other.ts",
                languageId: "typescript",
                version: 1,
            }),
        ).toBeNull();
        expect(answer).not.toHaveBeenCalled();
    });

    it("the token reaches the provider; cancelled by the answer: null and no session to leak", async () => {
        const { stub, languages } = makeCtx();
        const source = new CancellationTokenSource();
        let seen: vscode.CancellationToken | undefined;
        languages.registerCodeLensProvider("typescript", {
            provideCodeLenses: (_document, token) => {
                seen = token;
                source.cancel();
                return [lens()];
            },
        });
        expect(await provide(stub, source)).toBeNull();
        expect(seen?.isCancellationRequested).toBe(true);
    });
});

describe("languages.resolveCodeLens", () => {
    it("[api:CodeLensProvider.resolveCodeLens] asks with the original lens and token, answers its command", async () => {
        const { stub, languages } = makeCtx();
        const original = lens();
        const resolve = vi.fn((item: vscode.CodeLens) => {
            item.command = { command: "run", title: "Run" };
            return item;
        });
        languages.registerCodeLensProvider(
            "typescript",
            provider(() => [original], resolve),
        );
        const { lenses } = await provideList(stub);
        expect(await stub.callRequest("languages.resolveCodeLens", address(lenses[0].cacheId))).toEqual({
            cacheId: lenses[0].cacheId,
            range: WIRE_RANGE,
            command: { id: "run", title: "Run" },
        });
        expect(resolve.mock.calls[0][0]).toBe(original);
    });

    it("the provider may mutate the lens and answer nothing", async () => {
        const { stub, languages } = makeCtx();
        languages.registerCodeLensProvider(
            "typescript",
            provider(
                () => [lens()],
                (item) => {
                    item.command = { command: "run", title: "Run" };
                    return undefined;
                },
            ),
        );
        const { lenses } = await provideList(stub);
        expect(await stub.callRequest("languages.resolveCodeLens", address(lenses[0].cacheId))).toMatchObject({
            command: { id: "run", title: "Run" },
        });
    });

    it("a lens that already has a command is not resolved again", async () => {
        const { stub, languages } = makeCtx();
        const resolve = vi.fn();
        languages.registerCodeLensProvider(
            "typescript",
            provider(() => [lens({ command: "run", title: "Run" })], resolve),
        );
        const { lenses } = await provideList(stub);
        expect(await stub.callRequest("languages.resolveCodeLens", address(lenses[0].cacheId))).toMatchObject({
            command: { id: "run" },
        });
        expect(resolve).not.toHaveBeenCalled();
    });

    it.each([
        ["answers without a command", (): unknown => lens()],
        ["answers nothing", (): unknown => undefined],
    ])("%s: null and upstream's error, with the extension", async (_name, answer) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { stub, languages, owner } = makeCtx();
        owner.runAs("pub.ext", () =>
            languages.registerCodeLensProvider(
                "typescript",
                provider(() => [lens()], answer),
            ),
        );
        const { lenses } = await provideList(stub);
        expect(await stub.callRequest("languages.resolveCodeLens", address(lenses[0].cacheId))).toBeNull();
        expect(error).toHaveBeenCalledWith("[ext-host] [pub.ext] INVALID code lens resolved, lacks command");
    });

    it("a provider that cannot resolve: a lens without a command is the same error", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { stub, languages } = makeCtx();
        languages.registerCodeLensProvider(
            "typescript",
            provider(() => [lens()]),
        );
        const { lenses } = await provideList(stub);
        expect(await stub.callRequest("languages.resolveCodeLens", address(lenses[0].cacheId))).toBeNull();
        expect(error).toHaveBeenCalledOnce();
    });

    it("a throwing resolve: null, logged with the extension", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { stub, languages } = makeCtx();
        languages.registerCodeLensProvider(
            "typescript",
            provider(
                () => [lens()],
                () => {
                    throw new Error("resolve exploded");
                },
            ),
        );
        const { lenses } = await provideList(stub);
        expect(await stub.callRequest("languages.resolveCodeLens", address(lenses[0].cacheId))).toBeNull();
        expect(error).toHaveBeenCalledWith(
            expect.stringContaining("[ext-host] resolveCodeLens failed: Error: resolve exploded"),
        );
    });

    it("cancelled during the resolve: null, without the error", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { stub, languages } = makeCtx();
        const source = new CancellationTokenSource();
        languages.registerCodeLensProvider(
            "typescript",
            provider(
                () => [lens()],
                () => {
                    source.cancel();
                    return lens();
                },
            ),
        );
        const { lenses } = await provideList(stub);
        expect(
            await stub.callRequest("languages.resolveCodeLens", address(lenses[0].cacheId), source.token),
        ).toBeNull();
        expect(error).not.toHaveBeenCalled();
    });

    it("released during the resolve: null", async () => {
        const { stub, languages } = makeCtx();
        languages.registerCodeLensProvider(
            "typescript",
            provider(
                () => [lens()],
                () => {
                    stub.fire("languages.releaseCodeLenses", { handle: 0, cacheId: 1 });
                    return lens({ command: "run", title: "Run" });
                },
            ),
        );
        const { lenses, cacheId } = await provideList(stub);
        expect(cacheId).toBe(1);
        expect(await stub.callRequest("languages.resolveCodeLens", address(lenses[0].cacheId))).toBeNull();
    });

    it("an unknown handle, session or index: null", async () => {
        const { stub, languages } = makeCtx();
        languages.registerCodeLensProvider(
            "typescript",
            provider(() => [lens({ command: "run", title: "Run" })]),
        );
        const { cacheId } = await provideList(stub);
        expect(await stub.callRequest("languages.resolveCodeLens", address([cacheId, 0], 9))).toBeNull();
        expect(await stub.callRequest("languages.resolveCodeLens", address([cacheId + 1, 0]))).toBeNull();
        expect(await stub.callRequest("languages.resolveCodeLens", address([cacheId, 5]))).toBeNull();
        expect(await stub.callRequest("languages.resolveCodeLens", { handle: 0 })).toBeNull();
    });
});

describe("languages.releaseCodeLenses", () => {
    it("the session is gone: resolve and execute find nothing; another session stays", async () => {
        const { stub, languages, execute } = makeCtx();
        languages.registerCodeLensProvider(
            "typescript",
            provider(() => [lens({ command: "run", title: "Run" })]),
        );
        const first = await provideList(stub);
        const second = await provideList(stub);

        stub.fire("languages.releaseCodeLenses", { handle: 0, cacheId: first.cacheId });

        expect(await stub.callRequest("languages.resolveCodeLens", address(first.lenses[0].cacheId))).toBeNull();
        await stub.callRequest("languages.executeCodeLensCommand", address(first.lenses[0].cacheId));
        expect(execute).not.toHaveBeenCalled();
        expect(await stub.callRequest("languages.resolveCodeLens", address(second.lenses[0].cacheId))).not.toBeNull();
    });

    it("junk does not throw", () => {
        const { stub } = makeCtx();
        expect(() => {
            stub.fire("languages.releaseCodeLenses", null);
            stub.fire("languages.releaseCodeLenses", { handle: 9, cacheId: 1 });
        }).not.toThrow();
    });

    it("disposing the provider frees its sessions", async () => {
        const { stub, languages } = makeCtx();
        const registration = languages.registerCodeLensProvider(
            "typescript",
            provider(() => [lens({ command: "run", title: "Run" })]),
        );
        const { lenses } = await provideList(stub);
        registration.dispose();
        expect(await stub.callRequest("languages.resolveCodeLens", address(lenses[0].cacheId))).toBeNull();
    });
});

describe("languages.executeCodeLensCommand", () => {
    it("runs the command with the extension's very objects", async () => {
        const { stub, languages, execute } = makeCtx();
        const uri = Uri.parse(URI);
        const position = new Position(1, 2);
        const opaque = { notJson: new Map([[1, 2]]) };
        languages.registerCodeLensProvider(
            "typescript",
            provider(() => [lens({ command: "run", title: "Run", arguments: [uri, position, opaque] })]),
        );
        const { lenses } = await provideList(stub);

        expect(await stub.callRequest("languages.executeCodeLensCommand", address(lenses[0].cacheId))).toBeUndefined();

        expect(execute).toHaveBeenCalledOnce();
        const [id, ...args] = execute.mock.calls[0] as unknown[];
        expect(id).toBe("run");
        expect(args[0]).toBe(uri);
        expect(args[1]).toBe(position);
        expect(args[2]).toBe(opaque);
    });

    it("a command without arguments runs without arguments", async () => {
        const { stub, languages, execute } = makeCtx();
        languages.registerCodeLensProvider(
            "typescript",
            provider(() => [lens({ command: "run", title: "Run" })]),
        );
        const { lenses } = await provideList(stub);
        await stub.callRequest("languages.executeCodeLensCommand", address(lenses[0].cacheId));
        expect(execute).toHaveBeenCalledWith("run");
    });

    it("runs what the resolve answered, even a new object", async () => {
        const { stub, languages, execute } = makeCtx();
        const argument = {};
        languages.registerCodeLensProvider(
            "typescript",
            provider(
                () => [lens()],
                () => lens({ command: "resolved", title: "Run", arguments: [argument] }),
            ),
        );
        const { lenses } = await provideList(stub);
        await stub.callRequest("languages.resolveCodeLens", address(lenses[0].cacheId));
        await stub.callRequest("languages.executeCodeLensCommand", address(lenses[0].cacheId));
        expect(execute.mock.calls[0][0]).toBe("resolved");
        expect(execute.mock.calls[0][1]).toBe(argument);
    });

    it("the failure of the command rejects the request", async () => {
        const { stub, languages, execute } = makeCtx();
        execute.mockRejectedValueOnce(new Error("command exploded"));
        languages.registerCodeLensProvider(
            "typescript",
            provider(() => [lens({ command: "run", title: "Run" })]),
        );
        const { lenses } = await provideList(stub);
        await expect(stub.callRequest("languages.executeCodeLensCommand", address(lenses[0].cacheId))).rejects.toThrow(
            "command exploded",
        );
    });

    it("a command nobody knows rejects in upstream's wording, without running", async () => {
        const { stub, languages, execute } = makeCtx((id) => id !== "missing");
        languages.registerCodeLensProvider(
            "typescript",
            provider(() => [lens({ command: "missing", title: "Run" })]),
        );
        const { lenses } = await provideList(stub);
        await expect(stub.callRequest("languages.executeCodeLensCommand", address(lenses[0].cacheId))).rejects.toThrow(
            "command 'missing' not found",
        );
        expect(execute).not.toHaveBeenCalled();
    });

    it("a lens without a command, an unknown address: nothing runs", async () => {
        const { stub, languages, execute } = makeCtx();
        languages.registerCodeLensProvider(
            "typescript",
            provider(() => [lens()]),
        );
        const { lenses, cacheId } = await provideList(stub);
        await stub.callRequest("languages.executeCodeLensCommand", address(lenses[0].cacheId));
        await stub.callRequest("languages.executeCodeLensCommand", address([cacheId, 0], 9));
        await stub.callRequest("languages.executeCodeLensCommand", {});
        expect(execute).not.toHaveBeenCalled();
    });
});
