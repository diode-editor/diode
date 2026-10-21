import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { FileOperationResult } from "../../../../platform/files/common/files.ts";
import { FileService } from "../../../../platform/files/common/fileService.ts";
import { FileSystemProviderAdapter } from "../../../api/browser/fileSystemProviderAdapter.ts";

const fixture = extensionFixture("diode.fs", "providesFileSystem.cjs");

async function harnessWithProvider() {
    const harness = await createExtensionTestHarness({ extensions: [fixture] });
    await harness.flushRpc(6);
    return harness;
}

describe("ExtensionHost — extension file system providers", () => {
    it("the subprocess declares schemes and their writability, and the host sees them", async () => {
        const harness = await harnessWithProvider();
        try {
            expect(harness.host.getFileSystemSchemes()).toEqual(["demo", "memo"]);
            expect(harness.host.isReadonlyFileSystem("demo")).toBe(true);
            expect(harness.host.isReadonlyFileSystem("memo")).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("through the adapter the core writes to a writable provider: create, overwrite, stat", async () => {
        // The save chain for the right side of a proposed diff.
        const harness = await harnessWithProvider();
        const registry = new FileService();
        const adapter = new FileSystemProviderAdapter(harness.host, registry);
        const uri = Uri.parse("memo:/repo/a.ts");
        try {
            await expect(harness.host.statProvidedFile(uri)).resolves.toBeNull();

            await registry.writeFile(uri, new TextEncoder().encode("first"));
            const written = await registry.writeFile(uri, new TextEncoder().encode("second"));

            await expect(harness.commandRegistry.execute("memo.read", "/repo/a.ts")).resolves.toBe("second");
            expect(written.size).toBe(new TextEncoder().encode("second").length);
            expect(new TextDecoder().decode((await registry.readFile(uri)).value)).toBe("second");
        } finally {
            adapter.dispose();
            await harness.dispose();
        }
    });

    it("the core rejects a write to a read-only scheme without reaching the subprocess; a direct request is refused", async () => {
        const harness = await harnessWithProvider();
        const registry = new FileService();
        const adapter = new FileSystemProviderAdapter(harness.host, registry);
        try {
            await expect(registry.writeFile(Uri.parse("demo:/a"), new Uint8Array())).rejects.toMatchObject({
                result: FileOperationResult.PermissionDenied,
            });
            await expect(harness.host.writeProvidedFile(Uri.parse("demo:/a"), new Uint8Array())).rejects.toThrow();
        } finally {
            adapter.dispose();
            await harness.dispose();
        }
    });

    it("the host reads a resource through the subprocess provider", async () => {
        const harness = await harnessWithProvider();
        try {
            const bytes = await harness.host.readProvidedFile(Uri.parse("demo:/repo/a.ts"));
            expect(new TextDecoder().decode(bytes)).toBe("contents /repo/a.ts");
        } finally {
            await harness.dispose();
        }
    });

    it("a provider error reaches the host as a rejection, not as empty content", async () => {
        const harness = await harnessWithProvider();
        try {
            await expect(harness.host.readProvidedFile(Uri.parse("demo:/missing"))).rejects.toThrow();
        } finally {
            await harness.dispose();
        }
    });

    it("a read for an unregistered scheme is rejected", async () => {
        const harness = await harnessWithProvider();
        try {
            await expect(harness.host.readProvidedFile(Uri.parse("nope:/x"))).rejects.toThrow();
        } finally {
            await harness.dispose();
        }
    });

    it("onDidChangeFile from the extension reaches the host", async () => {
        const harness = await harnessWithProvider();
        try {
            const seen: string[] = [];
            harness.host.onDidChangeProvidedFile((uris) => {
                for (const uri of uris) seen.push(uri.toString());
            });

            await harness.commandRegistry.execute("demo.fireChange", "/repo/a.ts");
            await harness.flushRpc(4);

            expect(seen).toEqual(["demo:/repo/a.ts"]);
        } finally {
            await harness.dispose();
        }
    });

    it("a resource is read end-to-end through the adapter and the core registry", async () => {
        // The chain the live gutter uses.
        const harness = await harnessWithProvider();
        const registry = new FileService();
        const adapter = new FileSystemProviderAdapter(harness.host, registry);
        try {
            expect(registry.hasProvider(Uri.from({ scheme: "demo", path: "/" }))).toBe(true);

            const bytes = (await registry.readFile(Uri.parse("demo:/repo/b.ts"))).value;
            expect(new TextDecoder().decode(bytes)).toBe("contents /repo/b.ts");
        } finally {
            adapter.dispose();
            await harness.dispose();
        }
    });

    it("a resource change reaches the core registry", async () => {
        const harness = await harnessWithProvider();
        const registry = new FileService();
        const adapter = new FileSystemProviderAdapter(harness.host, registry);
        try {
            const seen: string[] = [];
            registry.onDidFilesChange((uris) => {
                for (const uri of uris) seen.push(uri.toString());
            });

            await harness.commandRegistry.execute("demo.fireChange", "/repo/c.ts");
            await harness.flushRpc(4);

            expect(seen).toEqual(["demo:/repo/c.ts"]);
        } finally {
            adapter.dispose();
            await harness.dispose();
        }
    });
});
