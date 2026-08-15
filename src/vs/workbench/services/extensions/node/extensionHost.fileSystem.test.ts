import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { FileSystemProviderRegistry } from "../../../../platform/files/common/fileSystemProviderRegistry.ts";
import { FileSystemProviderAdapter } from "../../../api/browser/fileSystemProviderAdapter.ts";

/**
 * Тест продюсера для нового RPC `workspace.fs.readFile` + нотификаций
 * `workspace.fileSystemProvidersChanged` / `workspace.fs.didChangeFile`
 * (требование AGENTS.md: «субпроцесс умеет разобрать сообщение» — только
 * половина контракта, вторая — кто и по какому событию его шлёт).
 *
 * Гоняется на НАСТОЯЩЕМ субпроцессе с настоящим расширением: оно регистрирует
 * `FileSystemProvider` для схемы `demo:`, а хост читает ресурс сквозь мост.
 */

const fixture = extensionFixture("diode.fs", "providesFileSystem.cjs");

async function harnessWithProvider() {
    const harness = await createExtensionTestHarness({ extensions: [fixture] });
    await harness.flushRpc(6);
    return harness;
}

describe("ExtensionHost — провайдеры ФС расширений", () => {
    it("субпроцесс объявляет схему, хост её видит", async () => {
        const harness = await harnessWithProvider();
        try {
            expect(harness.host.getFileSystemSchemes()).toEqual(["demo"]);
        } finally {
            await harness.dispose();
        }
    });

    it("хост читает ресурс провайдером субпроцесса", async () => {
        const harness = await harnessWithProvider();
        try {
            const bytes = await harness.host.readProvidedFile(Uri.parse("demo:/repo/a.ts"));
            expect(new TextDecoder().decode(bytes)).toBe("содержимое /repo/a.ts");
        } finally {
            await harness.dispose();
        }
    });

    it("ошибка провайдера доходит до хоста отказом, а не пустым содержимым", async () => {
        const harness = await harnessWithProvider();
        try {
            await expect(harness.host.readProvidedFile(Uri.parse("demo:/missing"))).rejects.toThrow();
        } finally {
            await harness.dispose();
        }
    });

    it("чтение по незарегистрированной схеме отклоняется", async () => {
        const harness = await harnessWithProvider();
        try {
            await expect(harness.host.readProvidedFile(Uri.parse("nope:/x"))).rejects.toThrow();
        } finally {
            await harness.dispose();
        }
    });

    it("onDidChangeFile из расширения доходит до хоста", async () => {
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

    it("сквозь адаптер и реестр ядра ресурс читается end-to-end", async () => {
        // Полная цепочка, которой пользуется живой гуттер:
        // расширение → RPC → ExtensionHost → адаптер → IFileSystemProviderRegistry.
        const harness = await harnessWithProvider();
        const registry = new FileSystemProviderRegistry();
        const adapter = new FileSystemProviderAdapter(harness.host, registry);
        try {
            expect(registry.hasProvider("demo")).toBe(true);

            const bytes = await registry.readFile(Uri.parse("demo:/repo/b.ts"));
            expect(new TextDecoder().decode(bytes)).toBe("содержимое /repo/b.ts");
        } finally {
            adapter.dispose();
            await harness.dispose();
        }
    });

    it("изменение ресурса доходит до реестра ядра", async () => {
        const harness = await harnessWithProvider();
        const registry = new FileSystemProviderRegistry();
        const adapter = new FileSystemProviderAdapter(harness.host, registry);
        try {
            const seen: string[] = [];
            registry.onDidChangeFile((uris) => {
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
