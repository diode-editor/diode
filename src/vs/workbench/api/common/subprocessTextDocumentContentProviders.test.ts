import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";

import { SubprocessTextDocumentContentProviders } from "./subprocessTextDocumentContentProviders.ts";
import { EventEmitter, Uri } from "./vscodeTypes.ts";

/** Провайдер-фикстура: содержимое по замыканию плюс необязательный `onDidChange`. */
function provider(content: string | null | undefined, changed?: EventEmitter<Uri>): vscode.TextDocumentContentProvider {
    return {
        ...(changed !== undefined ? { onDidChange: changed.event as unknown as vscode.Event<vscode.Uri> } : {}),
        provideTextDocumentContent: () => content,
    } as unknown as vscode.TextDocumentContentProvider;
}

const JDT = Uri.parse("jdt://contents/lib.jar/pkg/Foo.java") as unknown as vscode.Uri;

describe("SubprocessTextDocumentContentProviders", () => {
    it("отдаёт содержимое провайдера своей схемы", async () => {
        const registry = new SubprocessTextDocumentContentProviders();
        registry.register("jdt", provider("class Foo {}"));

        expect(await registry.provide(JDT)).toBe("class Foo {}");
        expect(registry.has("jdt")).toBe(true);
        expect(registry.schemes()).toEqual(["jdt"]);
    });

    it("провайдеру выдаётся пригодный токен отмены, а не undefined", async () => {
        const registry = new SubprocessTextDocumentContentProviders();
        let seen: vscode.CancellationToken | undefined;
        registry.register("jdt", {
            provideTextDocumentContent: (_uri: vscode.Uri, token: vscode.CancellationToken) => {
                seen = token;
                return "x";
            },
        } as unknown as vscode.TextDocumentContentProvider);

        await registry.provide(JDT);

        // Контракт `provideTextDocumentContent(uri, token)`: провайдер вправе
        // читать `isCancellationRequested` и подписываться — заглушка обязана
        // быть настоящим токеном, иначе стоковое расширение падает на первой
        // же строке.
        expect(seen?.isCancellationRequested).toBe(false);
        expect(() => seen?.onCancellationRequested(() => undefined)).not.toThrow();
    });

    it("отмена запроса доходит до токена провайдера", async () => {
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

    it("чужая схема — null, а не исключение", async () => {
        const registry = new SubprocessTextDocumentContentProviders();
        registry.register("jdt", provider("x"));

        expect(await registry.provide(Uri.parse("class:///Foo.class") as unknown as vscode.Uri)).toBeNull();
        expect(registry.has("class")).toBe(false);
    });

    it("провайдер вернул undefined (ProviderResult разрешает) — это null", async () => {
        const registry = new SubprocessTextDocumentContentProviders();
        registry.register("jdt", provider(undefined));

        expect(await registry.provide(JDT)).toBeNull();
    });

    it("отказ провайдера пробрасывается — ядру нужна причина для сообщения", async () => {
        const registry = new SubprocessTextDocumentContentProviders();
        registry.register("jdt", {
            provideTextDocumentContent: () => {
                throw new Error("classFileContents failed");
            },
        } as unknown as vscode.TextDocumentContentProvider);

        await expect(registry.provide(JDT)).rejects.toThrow("classFileContents failed");
    });

    it("занятая схема — ошибка, как в VS Code", () => {
        const registry = new SubprocessTextDocumentContentProviders();
        registry.register("jdt", provider("a"));

        expect(() => registry.register("jdt", provider("b"))).toThrow(/already registered/u);
    });

    it("dispose снимает регистрацию и объявляет новый список схем", () => {
        const registry = new SubprocessTextDocumentContentProviders();
        const schemes: string[][] = [];
        registry.onDidChangeSchemes(() => schemes.push(registry.schemes()));

        const registration = registry.register("jdt", provider("a"));
        registry.register("class", provider("b"));
        registration.dispose();

        expect(schemes).toEqual([["jdt"], ["jdt", "class"], ["class"]]);
        expect(registry.has("jdt")).toBe(false);
    });

    it("dispose старой регистрации не убивает провайдера, успевшего занять схему заново", () => {
        const registry = new SubprocessTextDocumentContentProviders();
        const first = registry.register("jdt", provider("a"));
        first.dispose();
        registry.register("jdt", provider("b"));

        first.dispose();

        expect(registry.has("jdt")).toBe(true);
    });

    it("onDidChange провайдера пересылается наружу — по нему ядро перечитывает вкладку", () => {
        const registry = new SubprocessTextDocumentContentProviders();
        const changed = new EventEmitter<Uri>();
        registry.register("jdt", provider("a", changed));
        const seen: string[] = [];
        registry.onDidChange((uri) => seen.push(uri.toString()));

        changed.fire(Uri.parse("jdt:///Foo.java"));

        expect(seen).toEqual(["jdt:/Foo.java"]);
    });

    it("после снятия регистрации события провайдера больше не идут наружу", () => {
        const registry = new SubprocessTextDocumentContentProviders();
        const changed = new EventEmitter<Uri>();
        const registration = registry.register("jdt", provider("a", changed));
        const seen: string[] = [];
        registry.onDidChange((uri) => seen.push(uri.toString()));

        registration.dispose();
        changed.fire(Uri.parse("jdt:///Foo.java"));

        expect(seen).toEqual([]);
    });

    it("провайдер без onDidChange регистрируется и снимается штатно", () => {
        const registry = new SubprocessTextDocumentContentProviders();

        const registration = registry.register("jdt", provider("a"));

        expect(() => {
            registration.dispose();
        }).not.toThrow();
        expect(registry.schemes()).toEqual([]);
    });

    it("отписка слушателей снимает уведомления", () => {
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
