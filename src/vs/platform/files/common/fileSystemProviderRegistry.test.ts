import { describe, expect, it, vi } from "vitest";

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../TestUtils/disposableLeaks.ts";
import { Uri } from "../../../base/common/uri.ts";

import { FileSystemProviderRegistry } from "./fileSystemProviderRegistry.ts";
import type { IReadOnlyFileSystemProvider } from "./iFileSystemProviderRegistry.ts";
import { NULL_FILE_SYSTEM_PROVIDER_REGISTRY } from "./iFileSystemProviderRegistry.ts";

const disposables = ensureNoDisposablesAreLeakedInTestSuite();

/** Поставщик-фейк: отдаёт заданный текст и умеет вручную фаерить изменения. */
function fakeProvider(content = "hello"): IReadOnlyFileSystemProvider & { fire: (uris: readonly Uri[]) => void } {
    const listeners: ((uris: readonly Uri[]) => void)[] = [];
    return {
        readFile: () => Promise.resolve(new TextEncoder().encode(content)),
        onDidChangeFile: (cb) => {
            listeners.push(cb);
            return {
                dispose: () => {
                    const i = listeners.indexOf(cb);
                    if (i >= 0) listeners.splice(i, 1);
                },
            };
        },
        fire: (uris) => {
            for (const cb of [...listeners]) cb(uris);
        },
    };
}

const gitUri = Uri.from({ scheme: "git", path: "/repo/a.ts" });

describe("FileSystemProviderRegistry", () => {
    it("читает ресурс поставщиком его схемы", async () => {
        const registry = disposables.add(new FileSystemProviderRegistry());
        registry.registerProvider("git", fakeProvider("original text"));

        expect(new TextDecoder().decode(await registry.readFile(gitUri))).toBe("original text");
    });

    it("сообщает о наличии поставщика — чтобы потребитель не ловил исключение зря", () => {
        const registry = disposables.add(new FileSystemProviderRegistry());
        expect(registry.hasProvider("git")).toBe(false);
        registry.registerProvider("git", fakeProvider());
        expect(registry.hasProvider("git")).toBe(true);
    });

    it("readFile по незарегистрированной схеме отклоняется", async () => {
        const registry = disposables.add(new FileSystemProviderRegistry());
        await expect(registry.readFile(gitUri)).rejects.toThrow(/no file system provider for scheme "git"/);
    });

    it("повторная регистрация занятой схемы — ошибка", () => {
        const registry = disposables.add(new FileSystemProviderRegistry());
        registry.registerProvider("git", fakeProvider());
        expect(() => registry.registerProvider("git", fakeProvider())).toThrow(/already registered/);
    });

    it("после снятия регистрации схема свободна и читать нечем", async () => {
        const registry = disposables.add(new FileSystemProviderRegistry());
        const registration = registry.registerProvider("git", fakeProvider());
        registration.dispose();

        expect(registry.hasProvider("git")).toBe(false);
        await expect(registry.readFile(gitUri)).rejects.toThrow();
    });

    it("изменения поставщика доходят до подписчиков реестра", () => {
        const registry = disposables.add(new FileSystemProviderRegistry());
        const provider = fakeProvider();
        registry.registerProvider("git", provider);
        const seen = vi.fn();
        disposables.add(registry.onDidChangeFile(seen));

        provider.fire([gitUri]);

        expect(seen).toHaveBeenCalledExactlyOnceWith([gitUri]);
    });

    it("пустой список изменений не будит подписчиков", () => {
        const registry = disposables.add(new FileSystemProviderRegistry());
        const provider = fakeProvider();
        registry.registerProvider("git", provider);
        const seen = vi.fn();
        disposables.add(registry.onDidChangeFile(seen));

        provider.fire([]);

        expect(seen).not.toHaveBeenCalled();
    });

    it("снятие регистрации отписывает и от событий поставщика", () => {
        const registry = disposables.add(new FileSystemProviderRegistry());
        const provider = fakeProvider();
        const registration = registry.registerProvider("git", provider);
        const seen = vi.fn();
        disposables.add(registry.onDidChangeFile(seen));

        registration.dispose();
        provider.fire([gitUri]);

        expect(seen).not.toHaveBeenCalled();
    });

    it("отписанный слушатель больше не получает событий", () => {
        const registry = disposables.add(new FileSystemProviderRegistry());
        const provider = fakeProvider();
        registry.registerProvider("git", provider);
        const seen = vi.fn();
        registry.onDidChangeFile(seen).dispose();

        provider.fire([gitUri]);

        expect(seen).not.toHaveBeenCalled();
    });

    it("перерегистрация схемы переживает dispose прежней регистрации", async () => {
        // Иначе отложенный dispose умершего host'а сносил бы живого поставщика.
        const registry = disposables.add(new FileSystemProviderRegistry());
        const first = registry.registerProvider("git", fakeProvider("первый"));
        first.dispose();
        registry.registerProvider("git", fakeProvider("второй"));
        first.dispose();

        expect(registry.hasProvider("git")).toBe(true);
        expect(new TextDecoder().decode(await registry.readFile(gitUri))).toBe("второй");
    });
});

describe("FileSystemProviderRegistry — событие смены поставщиков", () => {
    it("регистрация и снятие будят подписчиков", () => {
        const registry = disposables.add(new FileSystemProviderRegistry());
        const seen = vi.fn();
        disposables.add(registry.onDidChangeProviders(seen));

        const registration = registry.registerProvider("git", fakeProvider());
        expect(seen).toHaveBeenCalledTimes(1);

        registration.dispose();
        expect(seen).toHaveBeenCalledTimes(2);
    });

    it("повторный dispose не фаерит второй раз", () => {
        const registry = disposables.add(new FileSystemProviderRegistry());
        const registration = registry.registerProvider("git", fakeProvider());
        const seen = vi.fn();
        disposables.add(registry.onDidChangeProviders(seen));

        registration.dispose();
        registration.dispose();

        expect(seen).toHaveBeenCalledTimes(1);
    });

    it("отписка работает", () => {
        const registry = disposables.add(new FileSystemProviderRegistry());
        const seen = vi.fn();
        registry.onDidChangeProviders(seen).dispose();

        registry.registerProvider("git", fakeProvider());

        expect(seen).not.toHaveBeenCalled();
    });
});

describe("NULL_FILE_SYSTEM_PROVIDER_REGISTRY", () => {
    it("поставщиков нет, чтение отклоняется, подписки — no-op", async () => {
        const registry = NULL_FILE_SYSTEM_PROVIDER_REGISTRY;

        expect(registry.hasProvider("git")).toBe(false);
        expect(() => {
            registry.registerProvider("git", fakeProvider()).dispose();
        }).not.toThrow();
        expect(() => {
            registry.onDidChangeFile(() => undefined).dispose();
        }).not.toThrow();
        expect(() => {
            registry.onDidChangeProviders(() => undefined).dispose();
        }).not.toThrow();
        await expect(registry.readFile(gitUri)).rejects.toThrow(/no file system provider/);
    });
});
