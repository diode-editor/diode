import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { FileService } from "../../../platform/files/common/fileService.ts";
import type { IExtensionFileSystemBridge } from "../common/iExtensionFileSystem.ts";
import { NULL_EXTENSION_FILE_SYSTEM_BRIDGE } from "../common/iExtensionFileSystem.ts";

import { FileSystemProviderAdapter } from "./fileSystemProviderAdapter.ts";

/** Управляемый мост: схемы и события изменений задаются тестом. */
function fakeBridge(initial: string[] = []) {
    let schemes = [...initial];
    const schemeListeners: (() => void)[] = [];
    const fileListeners: ((uris: readonly Uri[]) => void)[] = [];
    const bridge: IExtensionFileSystemBridge = {
        getFileSystemSchemes: () => schemes,
        onFileSystemProvidersChanged: (cb) => {
            schemeListeners.push(cb);
            return { dispose: () => schemeListeners.splice(schemeListeners.indexOf(cb), 1) };
        },
        readProvidedFile: (uri) => Promise.resolve(new TextEncoder().encode(`содержимое ${uri.toString()}`)),
        onDidChangeProvidedFile: (cb) => {
            fileListeners.push(cb);
            return { dispose: () => fileListeners.splice(fileListeners.indexOf(cb), 1) };
        },
    };
    return {
        bridge,
        setSchemes: (next: string[]) => {
            schemes = next;
            for (const cb of [...schemeListeners]) cb();
        },
        fireChange: (uris: readonly Uri[]) => {
            for (const cb of [...fileListeners]) cb(uris);
        },
        get fileListenerCount() {
            return fileListeners.length;
        },
    };
}

const gitUri = Uri.from({ scheme: "git", path: "/repo/a.ts" });
const outputUri = Uri.from({ scheme: "output", path: "/channel" });

describe("FileSystemProviderAdapter", () => {
    it("регистрирует схемы, объявленные до создания адаптера", async () => {
        const registry = new FileService();
        const { bridge } = fakeBridge(["git"]);

        new FileSystemProviderAdapter(bridge, registry);

        expect(registry.hasProvider(Uri.from({ scheme: "git", path: "/" }))).toBe(true);
        expect(new TextDecoder().decode((await registry.readFile(gitUri)).value)).toBe("содержимое git:/repo/a.ts");
    });

    it("подхватывает схему, появившуюся позже (расширение активировалось после старта)", () => {
        const registry = new FileService();
        const harness = fakeBridge([]);
        new FileSystemProviderAdapter(harness.bridge, registry);
        expect(registry.hasProvider(Uri.from({ scheme: "git", path: "/" }))).toBe(false);

        harness.setSchemes(["git"]);

        expect(registry.hasProvider(Uri.from({ scheme: "git", path: "/" }))).toBe(true);
    });

    it("снимает регистрацию исчезнувшей схемы", () => {
        const registry = new FileService();
        const harness = fakeBridge(["git", "output"]);
        new FileSystemProviderAdapter(harness.bridge, registry);

        harness.setSchemes(["git"]);

        expect(registry.hasProvider(Uri.from({ scheme: "git", path: "/" }))).toBe(true);
        expect(registry.hasProvider(Uri.from({ scheme: "output", path: "/" }))).toBe(false);
    });

    it("повторное объявление того же набора не пересоздаёт регистрации", () => {
        // Пересоздание уронило бы регистрацию в реестре с «схема уже занята».
        const registry = new FileService();
        const harness = fakeBridge(["git"]);
        new FileSystemProviderAdapter(harness.bridge, registry);

        expect(() => {
            harness.setSchemes(["git"]);
        }).not.toThrow();
        expect(registry.hasProvider(Uri.from({ scheme: "git", path: "/" }))).toBe(true);
    });

    it("событие изменения фильтруется по схеме поставщика", () => {
        const registry = new FileService();
        const harness = fakeBridge(["git", "output"]);
        new FileSystemProviderAdapter(harness.bridge, registry);
        const seen = vi.fn();
        registry.onDidFilesChange(seen);

        harness.fireChange([gitUri, outputUri]);

        // Два поставщика, но каждый отдал только свои ресурсы — не по разу на всё.
        expect(seen.mock.calls).toEqual([[[gitUri]], [[outputUri]]]);
    });

    it("изменение только чужой схемы не будит поставщика", () => {
        const registry = new FileService();
        const harness = fakeBridge(["git"]);
        new FileSystemProviderAdapter(harness.bridge, registry);
        const seen = vi.fn();
        registry.onDidFilesChange(seen);

        harness.fireChange([outputUri]);

        expect(seen).not.toHaveBeenCalled();
    });

    it("dispose снимает все регистрации и отписки", () => {
        const registry = new FileService();
        const harness = fakeBridge(["git"]);
        const adapter = new FileSystemProviderAdapter(harness.bridge, registry);

        adapter.dispose();

        expect(registry.hasProvider(Uri.from({ scheme: "git", path: "/" }))).toBe(false);
        expect(harness.fileListenerCount).toBe(0);
    });

    it("с NULL-мостом ничего не регистрирует", () => {
        const registry = new FileService();
        new FileSystemProviderAdapter(NULL_EXTENSION_FILE_SYSTEM_BRIDGE, registry);

        expect(registry.hasProvider(Uri.from({ scheme: "git", path: "/" }))).toBe(false);
    });
});

describe("NULL_EXTENSION_FILE_SYSTEM_BRIDGE", () => {
    it("схем нет, чтение отклоняется, подписки — no-op", async () => {
        const bridge = NULL_EXTENSION_FILE_SYSTEM_BRIDGE;

        expect(bridge.getFileSystemSchemes()).toEqual([]);
        expect(() => {
            bridge.onFileSystemProvidersChanged(() => undefined).dispose();
        }).not.toThrow();
        expect(() => {
            bridge.onDidChangeProvidedFile(() => undefined).dispose();
        }).not.toThrow();
        await expect(bridge.readProvidedFile(gitUri)).rejects.toThrow(/extension host is not running/);
    });
});
