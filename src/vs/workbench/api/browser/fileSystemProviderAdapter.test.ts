import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import {
    FileOperation,
    FileOperationResult,
    FileSystemProviderCapabilities,
    FileType,
} from "../../../platform/files/common/files.ts";
import { FileService } from "../../../platform/files/common/fileService.ts";
import type { IExtensionFileSystemBridge } from "../common/iExtensionFileSystem.ts";
import { NULL_EXTENSION_FILE_SYSTEM_BRIDGE } from "../common/iExtensionFileSystem.ts";

import { FileSystemProviderAdapter } from "./fileSystemProviderAdapter.ts";

function fakeBridge(initial: string[] = [], initialWritable: string[] = []) {
    let schemes = [...initial];
    let writable = new Set(initialWritable);
    const written = new Map<string, Uint8Array>();
    const schemeListeners: (() => void)[] = [];
    const fileListeners: ((uris: readonly Uri[]) => void)[] = [];
    const bridge: IExtensionFileSystemBridge = {
        getFileSystemSchemes: () => schemes,
        onFileSystemProvidersChanged: (cb) => {
            schemeListeners.push(cb);
            return { dispose: () => schemeListeners.splice(schemeListeners.indexOf(cb), 1) };
        },
        isReadonlyFileSystem: (scheme) => !writable.has(scheme),
        readProvidedFile: (uri) =>
            Promise.resolve(written.get(uri.toString()) ?? new TextEncoder().encode(`содержимое ${uri.toString()}`)),
        statProvidedFile: (uri) => {
            const content = written.get(uri.toString());
            return Promise.resolve(
                content === undefined ? null : { type: FileType.File, mtime: content.length, size: content.length },
            );
        },
        writeProvidedFile: (uri, content) => {
            written.set(uri.toString(), content);
            return Promise.resolve();
        },
        onDidChangeProvidedFile: (cb) => {
            fileListeners.push(cb);
            return { dispose: () => fileListeners.splice(fileListeners.indexOf(cb), 1) };
        },
    };
    return {
        bridge,
        written,
        setSchemes: (next: string[], nextWritable: string[] = []) => {
            schemes = next;
            writable = new Set(nextWritable);
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
        const register = vi.spyOn(registry, "registerProvider");

        expect(() => {
            harness.setSchemes(["git"]);
        }).not.toThrow();
        expect(registry.hasProvider(Uri.from({ scheme: "git", path: "/" }))).toBe(true);
        expect(register).not.toHaveBeenCalled();
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

    it("пишущая схема: запись уходит провайдеру, сервис видит Create, затем Write", async () => {
        const registry = new FileService();
        const harness = fakeBridge(["_claude_fs_right"], ["_claude_fs_right"]);
        new FileSystemProviderAdapter(harness.bridge, registry);
        const right = Uri.from({ scheme: "_claude_fs_right", path: "/repo/a.ts" });
        const operations = vi.fn();
        registry.onDidRunOperation(operations);

        expect(registry.hasCapability(right, FileSystemProviderCapabilities.Readonly)).toBe(false);
        // Ресурса ещё нет: stat провайдера — null, сервис создаёт.
        await registry.writeFile(right, new TextEncoder().encode("первое"));
        const stat = await registry.writeFile(right, new TextEncoder().encode("второе"));

        await expect(registry.stat(right.with({ path: "/repo/missing.ts" }))).rejects.toThrow(
            "'_claude_fs_right:/repo/missing.ts' does not exist",
        );
        expect(new TextDecoder().decode(harness.written.get(right.toString()))).toBe("второе");
        expect(stat.size).toBe(new TextEncoder().encode("второе").length);
        expect(operations.mock.calls.map(([e]) => (e as { operation: FileOperation }).operation)).toEqual([
            FileOperation.Create,
            FileOperation.Write,
        ]);
    });

    it("read-only схема: запись — PermissionDenied, мост не зовётся", async () => {
        const registry = new FileService();
        const harness = fakeBridge(["git"]);
        new FileSystemProviderAdapter(harness.bridge, registry);

        expect(registry.hasCapability(gitUri, FileSystemProviderCapabilities.Readonly)).toBe(true);
        await expect(registry.writeFile(gitUri, new Uint8Array())).rejects.toMatchObject({
            result: FileOperationResult.PermissionDenied,
        });
        expect(harness.written.size).toBe(0);
    });

    it("схема, сменившая записываемость, перерегистрируется", () => {
        const registry = new FileService();
        const harness = fakeBridge(["demo"]);
        new FileSystemProviderAdapter(harness.bridge, registry);
        const uri = Uri.from({ scheme: "demo", path: "/x" });

        harness.setSchemes(["demo"], ["demo"]);
        expect(registry.hasCapability(uri, FileSystemProviderCapabilities.Readonly)).toBe(false);

        harness.setSchemes(["demo"]);
        expect(registry.hasCapability(uri, FileSystemProviderCapabilities.Readonly)).toBe(true);
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
        await expect(bridge.statProvidedFile(gitUri)).rejects.toThrow(/extension host is not running/);
        await expect(bridge.writeProvidedFile(gitUri, new Uint8Array())).rejects.toThrow(
            /extension host is not running/,
        );
        expect(bridge.isReadonlyFileSystem("git")).toBe(true);
    });
});
