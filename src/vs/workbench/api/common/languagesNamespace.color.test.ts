import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Color, ColorInformation, ColorPresentation, Range } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const URI = "file:///proj/main.css";
const TEXT = "a { color: red; }\n";

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
    ctx.documentSync.open({ uri: URI, languageId: "css", version: 1, text: TEXT });
    return { stub, languages, owner };
}

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { handle: 0, uri: URI, languageId: "css", version: 1, ...overrides };
}

const RED_RANGE = new Range(0, 11, 0, 14);

function info(range: Range, red: number, green: number, blue: number, alpha: number): vscode.ColorInformation {
    return new ColorInformation(range, new Color(red, green, blue, alpha)) as unknown as vscode.ColorInformation;
}

function provider(answer: () => unknown): vscode.DocumentColorProvider {
    return {
        provideDocumentColors: () => answer() as vscode.ColorInformation[],
        provideColorPresentations: () => [],
    };
}

describe("LanguagesNamespace — registerColorProvider", () => {
    it("the registration is declared to the core as kind color, dispose removes it", () => {
        const { stub, languages } = makeCtx();
        const registration = languages.registerColorProvider(
            [{ language: "css" }, { scheme: "untitled" }, { pattern: "**/*.scss" }],
            provider(() => []),
        );
        registration.dispose();
        registration.dispose();
        expect(stub.notifies.filter((n) => n.method.startsWith("languages."))).toEqual([
            {
                method: "languages.register",
                params: {
                    handle: 0,
                    kind: "color",
                    selector: [{ language: "css" }, { scheme: "untitled" }, { pattern: "**/*.scss" }],
                },
            },
            { method: "languages.unregister", params: { handle: 0 } },
        ]);
    });
});

describe("LanguagesNamespace — languages.provideDocumentColors", () => {
    it("the provider sees the document; colors go over the wire as range and channels", async () => {
        const { stub, languages } = makeCtx();
        const provide = vi.fn((_doc: vscode.TextDocument, _token: vscode.CancellationToken) => [
            info(RED_RANGE, 1, 0, 0, 1),
            info(new Range(0, 0, 0, 1), 0, 0.5, 1, 0.25),
        ]);
        languages.registerColorProvider("css", { provideDocumentColors: provide, provideColorPresentations: () => [] });

        expect(await stub.callRequest("languages.provideDocumentColors", params())).toEqual([
            { range: createRange(0, 11, 0, 14), color: { red: 1, green: 0, blue: 0, alpha: 1 } },
            { range: createRange(0, 0, 0, 1), color: { red: 0, green: 0.5, blue: 1, alpha: 0.25 } },
        ]);
        expect(provide.mock.calls[0][0].getText()).toBe(TEXT);
    });

    it("no colors — an empty array, undefined or not an array — is null: the default detector takes over", async () => {
        const { stub, languages } = makeCtx();
        let answer: unknown = [];
        languages.registerColorProvider(
            "css",
            provider(() => answer),
        );
        const call = (): Promise<unknown> => stub.callRequest("languages.provideDocumentColors", params());

        expect(await call()).toBeNull();
        answer = undefined;
        expect(await call()).toBeNull();
        answer = null;
        expect(await call()).toBeNull();
        answer = { red: 1 };
        expect(await call()).toBeNull();
        answer = Promise.resolve([info(RED_RANGE, 1, 0, 0, 1)]);
        expect(await call()).toHaveLength(1);
    });

    it("a channel outside [0, 1] is clamped; NaN, a missing channel or a broken range drops only that color", async () => {
        const { stub, languages } = makeCtx();
        const good = info(RED_RANGE, 1, 0, 0, 1);
        languages.registerColorProvider(
            "css",
            provider(() => [
                info(RED_RANGE, 2, -1, 0.5, 7),
                info(RED_RANGE, Number.NaN, 0, 0, 1),
                info(RED_RANGE, 0, Number.NaN, 0, 1),
                info(RED_RANGE, 0, 0, Number.NaN, 1),
                info(RED_RANGE, 0, 0, 0, Number.NaN),
                { range: RED_RANGE, color: { red: 1, green: 0, blue: 0 } },
                { range: RED_RANGE, color: { red: "1", green: 0, blue: 0, alpha: 1 } },
                { range: RED_RANGE },
                { range: RED_RANGE, color: null },
                { range: RED_RANGE, color: 7 },
                { range: { start: 1 }, color: new Color(1, 0, 0, 1) },
                null,
                7,
                good,
            ]),
        );
        expect(await stub.callRequest("languages.provideDocumentColors", params())).toEqual([
            { range: createRange(0, 11, 0, 14), color: { red: 1, green: 0, blue: 0.5, alpha: 1 } },
            { range: createRange(0, 11, 0, 14), color: { red: 1, green: 0, blue: 0, alpha: 1 } },
        ]);
    });

    it("a throwing or rejecting provider is null and a line in the log with its extension", async () => {
        const { stub, languages, owner } = makeCtx();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        owner.runAs("pub.colors", () =>
            languages.registerColorProvider(
                "css",
                provider(() => {
                    throw new Error("boom");
                }),
            ),
        );
        languages.registerColorProvider(
            "css",
            provider(() => Promise.reject(new Error("bang"))),
        );
        expect(await stub.callRequest("languages.provideDocumentColors", params())).toBeNull();
        expect(await stub.callRequest("languages.provideDocumentColors", params({ handle: 1 }))).toBeNull();
        expect(errors.mock.calls.map((c) => c[0] as string)).toEqual([
            expect.stringContaining("[ext-host] [pub.colors] provideDocumentColors failed: Error: boom"),
            expect.stringContaining("[ext-host] provideDocumentColors failed: Error: bang"),
        ]);
        errors.mockRestore();
    });

    it("the request goes to its own handle; a removed handle or another document version — null without a call", async () => {
        const { stub, languages } = makeCtx();
        const first = vi.fn(() => [info(RED_RANGE, 1, 0, 0, 1)]);
        const second = vi.fn(() => [info(RED_RANGE, 0, 0, 1, 1)]);
        languages.registerColorProvider("css", { provideDocumentColors: first, provideColorPresentations: () => [] });
        const registration = languages.registerColorProvider("css", {
            provideDocumentColors: second,
            provideColorPresentations: () => [],
        });

        expect(await stub.callRequest("languages.provideDocumentColors", params({ handle: 1, version: 7 }))).toBeNull();
        expect(second).not.toHaveBeenCalled();
        expect(await stub.callRequest("languages.provideDocumentColors", params({ handle: 1 }))).toEqual([
            { range: createRange(0, 11, 0, 14), color: { red: 0, green: 0, blue: 1, alpha: 1 } },
        ]);
        expect(first).not.toHaveBeenCalled();
        expect(await stub.callRequest("languages.provideDocumentColors", params({ handle: undefined }))).toBeNull();

        registration.dispose();
        expect(await stub.callRequest("languages.provideDocumentColors", params({ handle: 1 }))).toBeNull();
        expect(second).toHaveBeenCalledOnce();
    });

    it("the core's cancellation reaches the provider's token", async () => {
        const { stub, languages } = makeCtx();
        let seen: vscode.CancellationToken | undefined;
        let answer: (colors: vscode.ColorInformation[]) => void = () => undefined;
        languages.registerColorProvider("css", {
            provideDocumentColors: (_doc, token) => {
                seen = token;
                return new Promise((resolve) => {
                    answer = resolve;
                });
            },
            provideColorPresentations: () => [],
        });
        const source = new CancellationTokenSource();
        const reply = stub.callRequest("languages.provideDocumentColors", params(), source.token);
        await Promise.resolve();
        expect(seen?.isCancellationRequested).toBe(false);
        source.cancel();
        expect(seen?.isCancellationRequested).toBe(true);
        answer([]);
        await reply;
    });
});

describe("vscode.Color*", () => {
    it("Color keeps the channels as given", () => {
        const color = new Color(0.1, 0.2, 0.3, 0.4);
        expect([color.red, color.green, color.blue, color.alpha]).toEqual([0.1, 0.2, 0.3, 0.4]);
    });

    it("ColorInformation rejects an empty range and a color that is not a Color, as upstream", () => {
        const color = new Color(1, 0, 0, 1);
        const value = new ColorInformation(RED_RANGE, color);
        expect(value.range).toBe(RED_RANGE);
        expect(value.color).toBe(color);
        expect(() => new ColorInformation(new Range(0, 1, 0, 1), color)).toThrow("Illegal argument: range");
        expect(() => new ColorInformation({} as Range, color)).toThrow("Illegal argument: range");
        const duck = { red: 1, green: 0, blue: 0, alpha: 1 } as Color;
        expect(() => new ColorInformation(RED_RANGE, duck)).toThrow("Illegal argument: color");
        expect(new ColorInformation(RED_RANGE, undefined as unknown as Color).color).toBeUndefined();
    });

    it("ColorPresentation needs a non-empty label", () => {
        expect(new ColorPresentation("#ff0000").label).toBe("#ff0000");
        expect(() => new ColorPresentation("")).toThrow("Illegal argument: label");
        expect(() => new ColorPresentation(7 as unknown as string)).toThrow("Illegal argument: label");
    });
});
