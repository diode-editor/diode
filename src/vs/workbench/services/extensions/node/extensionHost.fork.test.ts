import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";

describe("ExtensionHost — fork(process.execPath) из расширения", () => {
    // Путь vscode-languageclient при TransportKind.ipc (basedpyright): клиент сам
    // форкает process.execPath с модулем сервера. Проверяем полный roundtrip —
    // форк поднялся, IPC-канал живой, и ребёнок унаследовал окружение, которое
    // под SEA уводит diode-бинарь в node-режим (runAsNode), а не в ext-host-ветку.
    it("форк живой, IPC отвечает, ребёнок видит DIODE_RUN_AS_NODE=1 без DIODE_EXTENSION_HOST", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.fork", "forksExecPath.cjs")],
        });
        try {
            const report = (await harness.commandRegistry.execute("test.fork.roundtrip")) as {
                runAsNode: string | null;
                extensionHost: string | null;
            };
            expect(report.runAsNode).toBe("1");
            expect(report.extensionHost).toBeNull();
        } finally {
            await harness.dispose();
        }
    }, 30_000);
});
