import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";

import { SubprocessTextDocumentContentProviders } from "./subprocessTextDocumentContentProviders.ts";
import { EventEmitter, Uri } from "./vscodeTypes.ts";

function provider(content: string | null | undefined, changed?: EventEmitter<Uri>): vscode.TextDocumentContentProvider {
    return {
        ...(changed !== undefined ? { onDidChange: changed.event as unknown as vscode.Event<vscode.Uri> } : {}),
        provideTextDocumentContent: () => content,
    } as unknown as vscode.TextDocumentContentProvider;
}

const JDT = Uri.parse("jdt://contents/lib.jar/pkg/Foo.java") as unknown as vscode.Uri;

describe("SubprocessTextDocumentContentProviders", () => {
    it("returns the content of the provider for its scheme", async () => {
        const registry = new SubprocessTextDocumentContentProviders();
        registry.register("jdt", provider("class Foo {}"));

        expect(await registry.provide(JDT)).toBe("class Foo {}");
        expect(registry.has("jdt")).toBe(true);
        expect(registry.schemes()).toEqual(["jdt"]);
    });

    it("the provider gets a usable cancellation token, not undefined", async () => {
        const registry = new SubprocessTextDocumentContentProviders();
        let seen: vscode.CancellationToken | undefined;
        registry.register("jdt", {
            provideTextDocumentContent: (_uri: vscode.Uri, token: vscode.CancellationToken) => {
                seen = token;
                return "x";
            },
        } as unknown as vscode.TextDocumentContentProvider);

        await registry.provide(JDT);

        // A provider may read the token and subscribe to it: the stub must be a real
        // token, or a stock extension crashes on its very first line.
        expect(seen?.isCancellationRequested).toBe(false);
        expect(() => seen?.onCancellationRequested(() => undefined)).not.toThrow();
    });

    it("request cancellation reaches the provider token", async () => {
        const registry = new SubprocessTextDocumentContentProviders();
        const fired: string[] = [];
        let seen: vscode.CancellationToken | undefined;
        let release: () => void = () => undefined;
        registry.register("jdt", {
            provideTextDocumentContent: (_uri: vscode.Uri, token: vscode.CancellationToken) => {
                seen = token;
                token.onCancellationRequested(() => fired.push("cancelled"));
                return new Promise<string>((resolve) => {
                    release = () => {
                        resolve("late");
                    };
                });
            },
        } as unknown as vscode.TextDocumentContentProvider);

        const caller = new CancellationTokenSource();
        const pending = registry.provide(JDT, caller.token);
        await Promise.resolve();
        expect(seen?.isCancellationRequested).toBe(false);

        caller.cancel();
        expect(seen?.isCancellationRequested).toBe(true);
        expect(fired).toEqual(["cancelled"]);
        release();
        expect(await pending).toBe("late");
    });

    it("a foreign scheme gives null, not an exception", async () => {
        const registry = new SubprocessTextDocumentContentProviders();
        registry.register("jdt", provider("x"));

        expect(await registry.provide(Uri.parse("class:///Foo.class") as unknown as vscode.Uri)).toBeNull();
        expect(registry.has("class")).toBe(false);
    });

    it("provider returned undefined (ProviderResult allows it) — that is null", async () => {
        const registry = new SubprocessTextDocumentContentProviders();
        registry.register("jdt", provider(undefined));

        expect(await registry.provide(JDT)).toBeNull();
    });

    it("a provider rejection is propagated — the core needs the reason for the message", async () => {
        const registry = new SubprocessTextDocumentContentProviders();
        registry.register("jdt", {
            provideTextDocumentContent: () => {
                throw new Error("classFileContents failed");
            },
        } as unknown as vscode.TextDocumentContentProvider);

        await expect(registry.provide(JDT)).rejects.toThrow("classFileContents failed");
    });

    it("a taken scheme is an error, as in VS Code", () => {
        const registry = new SubprocessTextDocumentContentProviders();
        registry.register("jdt", provider("a"));

        expect(() => registry.register("jdt", provider("b"))).toThrow(/already registered/u);
    });

    it("dispose removes the registration and announces the new scheme list", () => {
        const registry = new SubprocessTextDocumentContentProviders();
        const schemes: string[][] = [];
        registry.onDidChangeSchemes(() => schemes.push(registry.schemes()));

        const registration = registry.register("jdt", provider("a"));
        registry.register("class", provider("b"));
        registration.dispose();

        expect(schemes).toEqual([["jdt"], ["jdt", "class"], ["class"]]);
        expect(registry.has("jdt")).toBe(false);
    });

    it("disposing an old registration does not kill a provider that has re-taken the scheme", () => {
        const registry = new SubprocessTextDocumentContentProviders();
        const first = registry.register("jdt", provider("a"));
        first.dispose();
        registry.register("jdt", provider("b"));

        first.dispose();

        expect(registry.has("jdt")).toBe(true);
    });

    it("the provider onDidChange is forwarded out — the core re-reads the tab on it", () => {
        const registry = new SubprocessTextDocumentContentProviders();
        const changed = new EventEmitter<Uri>();
        registry.register("jdt", provider("a", changed));
        const seen: string[] = [];
        registry.onDidChange((uri) => seen.push(uri.toString()));

        changed.fire(Uri.parse("jdt:///Foo.java"));

        expect(seen).toEqual(["jdt:/Foo.java"]);
    });

    it("after unregistering, provider events are no longer forwarded", () => {
        const registry = new SubprocessTextDocumentContentProviders();
        const changed = new EventEmitter<Uri>();
        const registration = registry.register("jdt", provider("a", changed));
        const seen: string[] = [];
        registry.onDidChange((uri) => seen.push(uri.toString()));

        registration.dispose();
        changed.fire(Uri.parse("jdt:///Foo.java"));

        expect(seen).toEqual([]);
    });

    it("a provider without onDidChange registers and unregisters normally", () => {
        const registry = new SubprocessTextDocumentContentProviders();

        const registration = registry.register("jdt", provider("a"));

        expect(() => {
            registration.dispose();
        }).not.toThrow();
        expect(registry.schemes()).toEqual([]);
    });

    it("unsubscribing listeners stops notifications", () => {
        const registry = new SubprocessTextDocumentContentProviders();
        const changed = new EventEmitter<Uri>();
        registry.register("jdt", provider("a", changed));
        const onSchemes = vi.fn();
        const onChange = vi.fn();
        registry.onDidChangeSchemes(onSchemes).dispose();
        registry.onDidChange(onChange).dispose();

        registry.register("class", provider("b"));
        changed.fire(Uri.parse("jdt:///Foo.java"));

        expect(onSchemes).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
    });
});
