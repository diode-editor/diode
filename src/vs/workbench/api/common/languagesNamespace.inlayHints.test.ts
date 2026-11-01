import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";
import { Emitter } from "../../../base/common/event.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { InlayHint, InlayHintKind, InlayHintLabelPart, Position } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const URI = "file:///proj/main.ts";
const TEXT = "const a = f(1);\nconst b = 2;\n";
const RANGE = createRange(0, 0, 1, 12);

function makeCtx(): { stub: IStubRpc; languages: typeof vscode.languages; owner: ExtensionOwner } {
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
    const { languages } = createLanguagesNamespace(ctx);
    ctx.documentSync.open({ uri: URI, languageId: "typescript", version: 1, text: TEXT });
    return { stub, languages, owner };
}

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { handle: 0, uri: URI, languageId: "typescript", version: 1, range: RANGE, ...overrides };
}

function provider(answer: () => unknown): vscode.InlayHintsProvider {
    return { provideInlayHints: () => answer() as vscode.InlayHint[] };
}

function hint(line: number, character: number, label: string | InlayHintLabelPart[], kind?: number): vscode.InlayHint {
    return new InlayHint(new Position(line, character), label, kind) as unknown as vscode.InlayHint;
}

const provide = (stub: IStubRpc, overrides: Record<string, unknown> = {}): Promise<unknown> =>
    stub.callRequest("languages.provideInlayHints", params(overrides));

describe("LanguagesNamespace — registerInlayHintsProvider", () => {
    it("[api:languages.registerInlayHintsProvider] the registration is declared as kind inlayHints, dispose removes it", () => {
        const { stub, languages } = makeCtx();
        const registration = languages.registerInlayHintsProvider(
            [{ language: "typescript" }, { scheme: "untitled" }],
            provider(() => []),
        );
        registration.dispose();
        registration.dispose();
        expect(stub.notifies.filter((n) => n.method.startsWith("languages."))).toEqual([
            {
                method: "languages.register",
                params: {
                    handle: 0,
                    kind: "inlayHints",
                    selector: [{ language: "typescript" }, { scheme: "untitled" }],
                },
            },
            { method: "languages.unregister", params: { handle: 0 } },
        ]);
    });

    it("onDidChangeInlayHints declares itself and notifies the host; dispose unsubscribes", () => {
        const { stub, languages } = makeCtx();
        const changed = new Emitter<void>();
        const registration = languages.registerInlayHintsProvider("typescript", {
            onDidChangeInlayHints: changed.event,
            provideInlayHints: () => [],
        });
        expect(stub.notifies.find((n) => n.method === "languages.register")?.params).toMatchObject({
            handle: 0,
            hasOnDidChange: true,
        });

        changed.fire();
        expect(stub.notifies.filter((n) => n.method === "languages.didChangeInlayHints")).toEqual([
            { method: "languages.didChangeInlayHints", params: { handle: 0 } },
        ]);

        registration.dispose();
        changed.fire();
        expect(stub.notifies.filter((n) => n.method === "languages.didChangeInlayHints")).toHaveLength(1);
    });
});

describe("LanguagesNamespace — languages.provideInlayHints", () => {
    it("[api:InlayHintsProvider.provideInlayHints] the provider sees the document and the range as vscode.Range", async () => {
        const { stub, languages } = makeCtx();
        const provideInlayHints = vi.fn(
            (_doc: vscode.TextDocument, _range: vscode.Range, _token: vscode.CancellationToken) => [
                hint(0, 7, ": number"),
            ],
        );
        languages.registerInlayHintsProvider("typescript", { provideInlayHints });

        expect(await provide(stub)).toEqual([{ position: { line: 0, character: 7 }, label: ": number" }]);
        const [doc, range] = provideInlayHints.mock.calls[0];
        expect(doc.getText()).toBe(TEXT);
        expect([range.start.line, range.start.character, range.end.line, range.end.character]).toEqual([0, 0, 1, 12]);
        expect(typeof range.contains).toBe("function");
    });

    it("[api:InlayHint.kind] [api:InlayHint.paddingLeft] [api:InlayHint.paddingRight] [api:InlayHintLabelPart.value] the wire carries kind, paddings and only the value of label parts", async () => {
        const { stub, languages } = makeCtx();
        const part = new InlayHintLabelPart("count");
        part.tooltip = "not carried";
        const parameter = hint(0, 12, [part, new InlayHintLabelPart(":")], InlayHintKind.Parameter);
        parameter.paddingRight = true;
        parameter.tooltip = "not carried";
        const type = hint(0, 7, ": number", InlayHintKind.Type);
        type.paddingLeft = true;
        languages.registerInlayHintsProvider(
            "typescript",
            provider(() => [parameter, type]),
        );

        expect(await provide(stub)).toStrictEqual([
            {
                position: { line: 0, character: 12 },
                label: [{ value: "count" }, { value: ":" }],
                kind: 2,
                paddingRight: true,
            },
            { position: { line: 0, character: 7 }, label: ": number", kind: 1, paddingLeft: true },
        ]);
    });

    it("no hints — an empty array, undefined, null or not an array — is null; a thenable is awaited", async () => {
        const { stub, languages } = makeCtx();
        let answer: unknown = [];
        languages.registerInlayHintsProvider(
            "typescript",
            provider(() => answer),
        );

        expect(await provide(stub)).toBeNull();
        answer = undefined;
        expect(await provide(stub)).toBeNull();
        answer = null;
        expect(await provide(stub)).toBeNull();
        answer = { position: new Position(0, 0), label: "x" };
        expect(await provide(stub)).toBeNull();
        answer = Promise.resolve([hint(0, 0, "x")]);
        expect(await provide(stub)).toHaveLength(1);
    });

    it("an empty label, a position outside the range or a broken entry costs only that hint", async () => {
        const { stub, languages } = makeCtx();
        languages.registerInlayHintsProvider(
            "typescript",
            provider(() => [
                hint(0, 1, ""),
                hint(0, 1, []),
                hint(0, 1, [new InlayHintLabelPart(""), new InlayHintLabelPart("")]),
                hint(5, 0, "after the range"),
                hint(1, 13, "after the range on its last line"),
                hint(0, 3, "before the range"),
                { position: { line: Number.NaN, character: 0 }, label: "x" },
                { position: { line: 0, character: "1" }, label: "x" },
                { position: null, label: "x" },
                { position: new Position(0, 5), label: 7 },
                null,
                7,
                hint(0, 4, "first in the range"),
                hint(1, 12, "last in the range"),
                hint(0, 5, [new InlayHintLabelPart(""), new InlayHintLabelPart("kept")]),
            ]),
        );

        expect(await provide(stub, { range: createRange(0, 4, 1, 12) })).toEqual([
            { position: { line: 0, character: 4 }, label: "first in the range" },
            { position: { line: 1, character: 12 }, label: "last in the range" },
            { position: { line: 0, character: 5 }, label: [{ value: "" }, { value: "kept" }] },
        ]);
    });

    it("a label part without a string value is left out; only such parts make the hint invalid", async () => {
        const { stub, languages } = makeCtx();
        languages.registerInlayHintsProvider(
            "typescript",
            provider(() => [
                { position: new Position(0, 0), label: [null, { value: 7 }] },
                { position: new Position(0, 1), label: [null, { value: 7 }, { value: "ok" }] },
            ]),
        );
        expect(await provide(stub)).toEqual([{ position: { line: 0, character: 1 }, label: [{ value: "ok" }] }]);
    });

    it("an unknown kind reaches the host, whose parser drops that one hint; only true is a padding", async () => {
        const { stub, languages } = makeCtx();
        languages.registerInlayHintsProvider(
            "typescript",
            provider(() => [
                { position: new Position(0, 0), label: "a", kind: 9, paddingLeft: 1, paddingRight: "yes" },
                { position: new Position(0, 1), label: "b", kind: null },
            ]),
        );
        expect(await provide(stub)).toStrictEqual([
            { position: { line: 0, character: 0 }, label: "a", kind: 9 },
            { position: { line: 0, character: 1 }, label: "b" },
        ]);
    });

    it("a throwing or rejecting provider is null and a line in the log with its extension", async () => {
        const { stub, languages, owner } = makeCtx();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        owner.runAs("pub.hints", () =>
            languages.registerInlayHintsProvider(
                "typescript",
                provider(() => {
                    throw new Error("boom");
                }),
            ),
        );
        languages.registerInlayHintsProvider(
            "typescript",
            provider(() => Promise.reject(new Error("bang"))),
        );
        expect(await provide(stub)).toBeNull();
        expect(await provide(stub, { handle: 1 })).toBeNull();
        expect(errors.mock.calls.map((c) => c[0] as string)).toEqual([
            expect.stringContaining("[ext-host] [pub.hints] provideInlayHints failed: Error: boom"),
            expect.stringContaining("[ext-host] provideInlayHints failed: Error: bang"),
        ]);
        errors.mockRestore();
    });

    it("the request goes to its own handle; a removed handle or another document version — null without a call", async () => {
        const { stub, languages } = makeCtx();
        const first = vi.fn(() => [hint(0, 0, "first")]);
        const second = vi.fn(() => [hint(0, 0, "second")]);
        languages.registerInlayHintsProvider("typescript", { provideInlayHints: first });
        const registration = languages.registerInlayHintsProvider("typescript", { provideInlayHints: second });

        expect(await provide(stub, { handle: 1, version: 7 })).toBeNull();
        expect(second).not.toHaveBeenCalled();
        expect(await provide(stub, { handle: 1 })).toEqual([{ position: { line: 0, character: 0 }, label: "second" }]);
        expect(first).not.toHaveBeenCalled();
        expect(await provide(stub, { handle: undefined })).toBeNull();

        registration.dispose();
        expect(await provide(stub, { handle: 1 })).toBeNull();
        expect(second).toHaveBeenCalledOnce();
    });

    it("the core's cancellation reaches the provider's token", async () => {
        const { stub, languages } = makeCtx();
        let seen: vscode.CancellationToken | undefined;
        let answer: (hints: vscode.InlayHint[]) => void = () => undefined;
        languages.registerInlayHintsProvider("typescript", {
            provideInlayHints: (_doc, _range, token) => {
                seen = token;
                return new Promise((resolve) => {
                    answer = resolve;
                });
            },
        });
        const source = new CancellationTokenSource();
        const reply = stub.callRequest("languages.provideInlayHints", params(), source.token);
        await Promise.resolve();
        expect(seen?.isCancellationRequested).toBe(false);
        source.cancel();
        expect(seen?.isCancellationRequested).toBe(true);
        answer([]);
        await reply;
    });
});

describe("vscode.InlayHint*", () => {
    it("[api:InlayHint] [api:InlayHint.position] [api:InlayHint.label] [api:InlayHintKind] [api:InlayHintKind.Type] [api:InlayHintKind.Parameter] [api:InlayHintLabelPart] keep what they are given; the kinds match upstream", () => {
        const position = new Position(1, 2);
        const part = new InlayHintLabelPart("name");
        const value = new InlayHint(position, [part], InlayHintKind.Parameter);
        expect(value.position).toBe(position);
        expect(value.label).toEqual([part]);
        expect(value.kind).toBe(2);
        expect(part.value).toBe("name");
        expect(InlayHintKind.Type).toBe(1);
        expect(new InlayHint(position, "x").kind).toBeUndefined();
    });
});
