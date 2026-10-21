import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { SignatureHelpTriggerKind as CoreTriggerKind } from "../../../editor/common/languages/iSignatureHelpSource.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { MarkdownString, ParameterInformation, SignatureHelp, SignatureInformation, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function makeCtx(stub: IStubRpc = makeStubRpc()): { ctx: IVscodeHostContext; stub: IStubRpc } {
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry, () => undefined),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    ctx.documentSync.open({ uri: URI, languageId: "typescript", version: 1, text: TEXT });
    return { ctx, stub };
}

const URI = "file:///proj/main.ts";
const TEXT = "greet(\n";

function requestParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        handle: 0,
        uri: URI,
        languageId: "typescript",
        version: 1,
        line: 0,
        character: 6,
        triggerKind: CoreTriggerKind.TriggerCharacter,
        triggerCharacter: "(",
        isRetrigger: false,
        ...overrides,
    };
}

function help(label: string, parameterLabel: string | [number, number] = "name: string"): vscode.SignatureHelp {
    const signature = new SignatureInformation(label, new MarkdownString("Says hello."));
    signature.parameters = [new ParameterInformation(parameterLabel, new MarkdownString("whom"))];
    const result = new SignatureHelp();
    result.signatures = [signature];
    result.activeSignature = 0;
    result.activeParameter = 0;
    return result as unknown as vscode.SignatureHelp;
}

describe("LanguagesNamespace — registerSignatureHelpProvider", () => {
    const provider = { provideSignatureHelp: () => null };
    const registrations = (stub: { notifies: { method: string; params: unknown }[] }): unknown[] =>
        stub.notifies.filter((n) => n.method === "languages.register").map((n) => n.params);

    it("registration is declared to the core with handle, selector and characters; dispose removes it once", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);

        const registration = languages.registerSignatureHelpProvider({ language: "typescript" }, provider);
        expect(registrations(stub)).toEqual([
            {
                handle: 0,
                kind: "signatureHelp",
                selector: [{ language: "typescript" }],
                triggerCharacters: [],
                retriggerCharacters: [],
            },
        ]);

        registration.dispose();
        registration.dispose();
        expect(stub.notifies.filter((n) => n.method === "languages.unregister")).toEqual([
            { method: "languages.unregister", params: { handle: 0 } },
        ]);
    });

    it("server metadata (both overloads) travels with its provider's registration", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);

        // The client's shape when the server capability has `retriggerCharacters`.
        languages.registerSignatureHelpProvider({ language: "typescript" }, provider, {
            triggerCharacters: ["(", ",", "<"],
            retriggerCharacters: [")"],
        });
        // The second overload passes rest strings; characters are NOT merged across
        // registrations: each provider has its own.
        languages.registerSignatureHelpProvider({ language: "python" }, provider, "(", "[");

        expect(registrations(stub)).toMatchObject([
            { handle: 0, triggerCharacters: ["(", ",", "<"], retriggerCharacters: [")"] },
            { handle: 1, triggerCharacters: ["(", "["], retriggerCharacters: [] },
        ]);
    });

    it("garbage instead of metadata does not break registration", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);

        languages.registerSignatureHelpProvider({ language: "typescript" }, provider, {
            triggerCharacters: "(" as unknown as string[],
            retriggerCharacters: [")", 7 as unknown as string],
        });

        expect(registrations(stub)).toMatchObject([{ triggerCharacters: [], retriggerCharacters: [")"] }]);
    });

    it("updateSubscriptions no longer carries signature help", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);

        languages.registerSignatureHelpProvider({ language: "typescript" }, provider, "(");

        expect(stub.notifies.filter((n) => n.method === "languages.updateSubscriptions")).toEqual([]);
    });
});

describe("LanguagesNamespace — languages.provideSignatureHelp", () => {
    it("calls the provider with the mirrored document, position and LSP context", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { doc?: vscode.TextDocument; pos?: vscode.Position; ctx?: vscode.SignatureHelpContext } = {};
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: (document, position, _token, context) => {
                    seen.doc = document;
                    seen.pos = position;
                    seen.ctx = context;
                    return help("greet(name: string): void");
                },
            },
        );

        const result = await stub.callRequest("languages.provideSignatureHelp", requestParams());

        expect(seen.doc).toBe(ctx.registry.get(Uri.parse(URI)));
        expect(seen.doc?.getText()).toBe("greet(\n");
        expect(seen.doc?.languageId).toBe("typescript");
        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(6);
        expect(seen.ctx).toEqual({
            triggerKind: CoreTriggerKind.TriggerCharacter,
            triggerCharacter: "(",
            isRetrigger: false,
            activeSignatureHelp: undefined,
        });
        // The provider's MarkdownString goes out as raw markdown — the UI strips it.
        expect(result).toEqual({
            signatures: [
                {
                    label: "greet(name: string): void",
                    documentation: "Says hello.",
                    parameters: [{ label: "name: string", documentation: "whom" }],
                },
            ],
            activeSignature: 0,
            activeParameter: 0,
        });
    });

    it("the echo of the shown help and the retrigger reach the provider", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: vscode.SignatureHelpContext[] = [];
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: (_doc, _pos, _token, context) => {
                    seen.push(context);
                    return null;
                },
            },
        );

        const active = {
            signatures: [{ label: "greet(): void", parameters: [] }],
            activeSignature: 0,
            activeParameter: 0,
        };
        await stub.callRequest(
            "languages.provideSignatureHelp",
            requestParams({ isRetrigger: true, activeSignatureHelp: active, triggerCharacter: "," }),
        );

        expect(seen[0]).toMatchObject({ isRetrigger: true, triggerCharacter: "," });
        expect(seen[0].activeSignatureHelp).toEqual(active);
        // The provider sees API class instances, as in VS Code, not a plain wire object.
        expect(seen[0].activeSignatureHelp).toBeInstanceOf(SignatureHelp);
    });

    it("context without fields: Invoke by default, isRetrigger is false", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: vscode.SignatureHelpContext[] = [];
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: (_doc, _pos, _token, context) => {
                    seen.push(context);
                    return null;
                },
            },
        );

        await stub.callRequest(
            "languages.provideSignatureHelp",
            requestParams({ triggerKind: undefined, triggerCharacter: undefined, isRetrigger: "yes" }),
        );

        expect(seen[0]).toMatchObject({ triggerKind: CoreTriggerKind.Invoke, isRetrigger: false });
        expect(seen[0].triggerCharacter).toBeUndefined();
    });

    it("exactly the requested handle's provider is called; failing and empty ones give null", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const asked: string[] = [];
        const ask = (handle: number) => stub.callRequest("languages.provideSignatureHelp", requestParams({ handle }));

        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => {
                    asked.push("throws");
                    throw new Error("boom");
                },
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => {
                    asked.push("null");
                    return null;
                },
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => {
                    asked.push("empty");
                    const empty = new SignatureHelp();
                    return empty as unknown as vscode.SignatureHelp;
                },
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => {
                    asked.push("winner");
                    return help("greet(name: string): void");
                },
            },
        );

        const result = await ask(3);
        expect(asked).toEqual(["winner"]);
        expect((result as { signatures: { label: string }[] }).signatures[0].label).toBe("greet(name: string): void");

        expect(await ask(0)).toBeNull();
        expect(await ask(1)).toBeNull();
        expect(await ask(2)).toBeNull();
        expect(asked).toEqual(["winner", "throws", "null", "empty"]);
    });

    it("async provider and promise rejection", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            { provideSignatureHelp: () => Promise.reject(new Error("boom")) },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            { provideSignatureHelp: () => Promise.resolve(help("greet(name: string): void")) },
        );

        expect(await stub.callRequest("languages.provideSignatureHelp", requestParams())).toBeNull();
        const result = await stub.callRequest("languages.provideSignatureHelp", requestParams({ handle: 1 }));

        expect((result as { signatures: { label: string }[] }).signatures[0].label).toBe("greet(name: string): void");
    });

    it("a broken shape from the provider is rejected entirely", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({
                        signatures: [{ label: 42 }],
                        activeSignature: 0,
                        activeParameter: 0,
                    }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => ({ signatures: "no" }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({
                        signatures: [{ label: "f(a)", parameters: [{ label: null }] }],
                    }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => ({ signatures: [42] }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => ({ signatures: [null] }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({ signatures: [{ label: "f(a)", parameters: 42 }] }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({
                        signatures: [{ label: "f(a)", parameters: [{ label: [1, 2, 3] }] }],
                    }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({
                        signatures: [{ label: "f(a)", parameters: [{ label: ["x", 1] }] }],
                    }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({ signatures: [{ label: "f(a)", parameters: "no" }] }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({ signatures: [{ label: "f(a)", parameters: [null] }] }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({
                        signatures: [{ label: "f(a)", parameters: [{ label: [1, "x"] }] }],
                    }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            { provideSignatureHelp: () => help("greet(name: string): void") },
        );

        for (let handle = 0; handle < 11; handle++) {
            expect(await stub.callRequest("languages.provideSignatureHelp", requestParams({ handle }))).toBeNull();
        }
        const result = await stub.callRequest("languages.provideSignatureHelp", requestParams({ handle: 11 }));

        expect((result as { signatures: { label: string }[] }).signatures[0].label).toBe("greet(name: string): void");
    });

    it("minimal provider shape: no parameters, no documentation, no indices", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({ signatures: [{ label: "now(): Date" }] }) as unknown as vscode.SignatureHelp,
            },
        );

        const result = (await stub.callRequest("languages.provideSignatureHelp", requestParams())) as {
            signatures: Record<string, unknown>[];
        };

        expect(result).toEqual({
            signatures: [{ label: "now(): Date", parameters: [] }],
            activeSignature: 0,
            activeParameter: 0,
        });
        // The `documentation`/`activeParameter` keys must not be on the wire at all:
        // `{ documentation: undefined }` is an extra byte on every answer.
        expect(Object.keys(result.signatures[0]).sort()).toEqual(["label", "parameters"]);
    });

    it("a parameter without documentation arrives as a bare label", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({
                        signatures: [{ label: "greet(name)", parameters: [{ label: "name" }] }],
                        activeSignature: "no",
                        activeParameter: null,
                    }) as unknown as vscode.SignatureHelp,
            },
        );

        const result = await stub.callRequest("languages.provideSignatureHelp", requestParams());

        expect(result).toEqual({
            signatures: [{ label: "greet(name)", parameters: [{ label: "name" }] }],
            // Non-numeric indices are coerced to zero already in the serializer.
            activeSignature: 0,
            activeParameter: 0,
        });
        const parameter = (result as { signatures: { parameters: Record<string, unknown>[] }[] }).signatures[0]
            .parameters[0];
        expect(Object.keys(parameter)).toEqual(["label"]);
    });

    it("the overload chosen by the server arrives as is", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({
                        signatures: [{ label: "f(a)" }, { label: "f(a, b)" }],
                        activeSignature: 1,
                        activeParameter: 1,
                    }) as unknown as vscode.SignatureHelp,
            },
        );

        const result = (await stub.callRequest("languages.provideSignatureHelp", requestParams())) as {
            activeSignature: number;
            activeParameter: number;
        };

        expect(result.activeSignature).toBe(1);
        expect(result.activeParameter).toBe(1);
    });

    it("a parameter label as an offset pair and active indices are serialized as is", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => {
                    const value = help("greet(name: string): void", [6, 18]);
                    (value as unknown as { activeSignature: number }).activeSignature = 0;
                    (value as unknown as { activeParameter: number }).activeParameter = -1;
                    value.signatures[0].activeParameter = 1;
                    return value;
                },
            },
        );

        const result = (await stub.callRequest("languages.provideSignatureHelp", requestParams())) as {
            signatures: { parameters: { label: unknown }[]; activeParameter?: number }[];
            activeParameter: number;
        };

        expect(result.signatures[0].parameters[0].label).toEqual([6, 18]);
        expect(result.signatures[0].activeParameter).toBe(1);
        expect(result.activeParameter).toBe(-1);
    });

    it("params without fields (except version): mirrored document, language not overwritten, position at file start", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { doc?: vscode.TextDocument; pos?: vscode.Position } = {};
        languages.registerSignatureHelpProvider("*", {
            provideSignatureHelp: (document, position) => {
                seen.doc = document;
                seen.pos = position;
                return null;
            },
        });

        await stub.callRequest("languages.provideSignatureHelp", {
            handle: 0,
            uri: URI,
            version: 1,
            triggerKind: CoreTriggerKind.Invoke,
            isRetrigger: false,
        });

        expect(seen.doc?.getText()).toBe(TEXT);
        expect(seen.doc?.languageId).toBe("typescript");
        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(0);
    });

    it("an unknown or missing handle gives no help, calls no one, does not sync the document", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        let asked = false;
        const provider: vscode.SignatureHelpProvider = {
            provideSignatureHelp: () => {
                asked = true;
                return help("greet()");
            },
        };
        languages.registerSignatureHelpProvider({ language: "typescript" }, provider);
        languages.registerSignatureHelpProvider({ language: "typescript" }, provider);

        const stale = "file:///proj/stale.ts";
        expect(
            await stub.callRequest("languages.provideSignatureHelp", requestParams({ handle: 5, uri: stale })),
        ).toBeNull();
        expect(ctx.registry.get(Uri.parse(stale))).toBeUndefined();
        expect(
            await stub.callRequest("languages.provideSignatureHelp", requestParams({ handle: undefined })),
        ).toBeNull();
        expect(asked).toBe(false);
    });

    it("a document that is not open, a stale or ahead version give null, the provider is not called", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        let asked = 0;
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => {
                    asked++;
                    return help("greet(name: string): void");
                },
            },
        );
        ctx.documentSync.change({ uri: URI, version: 2, changes: [] });

        const stale = [{ uri: "file:///proj/unknown.ts" }, { version: 1 }, { version: 3 }, { version: undefined }];
        for (const overrides of stale) {
            expect(await stub.callRequest("languages.provideSignatureHelp", requestParams(overrides))).toBeNull();
        }
        expect(asked).toBe(0);
        expect(await stub.callRequest("languages.provideSignatureHelp", requestParams({ version: 2 }))).not.toBeNull();
        expect(asked).toBe(1);
    });
});
