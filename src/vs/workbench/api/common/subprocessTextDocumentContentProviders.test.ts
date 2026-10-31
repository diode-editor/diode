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

    it("[api:workspace.registerTextDocumentContentProvider] upstream's reserved schemes are refused by the key of `Schemas`, with its message", () => {
        const registry = new SubprocessTextDocumentContentProviders();

        for (const scheme of ["file", "untitled", "vscode", "http", "inMemory", "copilotPr", "vscodeRemote"]) {
            expect(() => registry.register(scheme, provider("a"))).toThrow(`scheme '${scheme}' already registered`);
        }
        expect(registry.schemes()).toEqual([]);
        // The value of `Schemas.vscodeRemote`, not its key: upstream lets it through.
        expect(() => registry.register("vscode-remote", provider("a"))).not.toThrow();
    });

    it("[api:workspace.registerTextDocumentContentProvider] several providers on a scheme: the newest that answers wins", async () => {
        const registry = new SubprocessTextDocumentContentProviders();
        registry.register("jdt", provider("older"));
        registry.register("jdt", {
            provideTextDocumentContent: (uri: vscode.Uri) => (uri.authority === "mine" ? "newer" : undefined),
        } as unknown as vscode.TextDocumentContentProvider);

        expect(await registry.provide(Uri.parse("jdt://mine/x") as unknown as vscode.Uri)).toBe("newer");
        expect(await registry.provide(Uri.parse("jdt://other/x") as unknown as vscode.Uri)).toBe("older");
    });

    it("a failing provider does not hide the one that answers; alone, its failure propagates", async () => {
        const registry = new SubprocessTextDocumentContentProviders();
        const evil = {
            provideTextDocumentContent: () => {
                throw new Error("first failure");
            },
        } as unknown as vscode.TextDocumentContentProvider;
        const silent = provider(undefined);
        registry.register("jdt", provider("good"));
        const evilRegistration = registry.register("jdt", evil);

        expect(await registry.provide(JDT)).toBe("good");

        const second = new SubprocessTextDocumentContentProviders();
        second.register("jdt", {
            provideTextDocumentContent: () => {
                throw new Error("second failure");
            },
        } as unknown as vscode.TextDocumentContentProvider);
        second.register("jdt", evil);
        second.register("jdt", silent);
        const failure: unknown = await second.provide(JDT).catch((error: unknown) => error);
        expect((failure as Error).message).toBe("first failure");
        evilRegistration.dispose();
    });

    it("an answer that is not a string is no answer, an empty string is one", async () => {
        const registry = new SubprocessTextDocumentContentProviders();
        registry.register("jdt", {
            provideTextDocumentContent: () => 123,
        } as unknown as vscode.TextDocumentContentProvider);
        expect(await registry.provide(JDT)).toBeNull();

        registry.register("jdt", provider(""));
        expect(await registry.provide(JDT)).toBe("");
    });

    it("the scheme list changes with the first provider of a scheme and with the last, not in between", () => {
        const registry = new SubprocessTextDocumentContentProviders();
        const onSchemes = vi.fn();
        registry.onDidChangeSchemes(onSchemes);

        const first = registry.register("jdt", provider("a"));
        const second = registry.register("jdt", provider("b"));
        expect(onSchemes).toHaveBeenCalledTimes(1);

        first.dispose();
        first.dispose();
        expect(onSchemes).toHaveBeenCalledTimes(1);
        expect(registry.has("jdt")).toBe(true);

        second.dispose();
        second.dispose();
        expect(onSchemes).toHaveBeenCalledTimes(2);
        expect(registry.has("jdt")).toBe(false);
    });

    it("disposing one provider leaves the other answering and stops only its own events", async () => {
        const registry = new SubprocessTextDocumentContentProviders();
        const changedA = new EventEmitter<Uri>();
        const changedB = new EventEmitter<Uri>();
        const onChange = vi.fn();
        registry.onDidChange(onChange);
        registry.register("jdt", provider("a", changedA));
        const b = registry.register("jdt", provider("b", changedB));

        b.dispose();
        changedB.fire(JDT as unknown as Uri);
        expect(onChange).not.toHaveBeenCalled();
        changedA.fire(JDT as unknown as Uri);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(await registry.provide(JDT)).toBe("a");
    });

    it("an event for a foreign scheme is ignored with upstream's warning", () => {
        const registry = new SubprocessTextDocumentContentProviders();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const changed = new EventEmitter<Uri>();
        const onChange = vi.fn();
        registry.onDidChange(onChange);
        registry.register("jdt", provider("a", changed));

        changed.fire(Uri.parse("other:/x"));

        expect(onChange).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(
            "Provider for scheme 'jdt' is firing event for schema 'other' which will be IGNORED",
        );
        warn.mockRestore();
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
