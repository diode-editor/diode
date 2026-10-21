import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";

// Как у ext host'а VS Code (`--dns-result-order=ipv4first`): Java-клиенты стучатся
// в 127.0.0.1, и сервер на `::1` для них не существует.
describe("ExtensionHost — localhost резолвится в IPv4", () => {
    it("порядок резолва ipv4first, TCP-сервер на localhost встаёт на 127.0.0.1", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.localhost", "reportsLocalhost.cjs")],
        });
        try {
            expect(await harness.commandRegistry.execute("test.localhost.resultOrder")).toBe("ipv4first");
            expect(await harness.commandRegistry.execute("test.localhost.listen")).toBe("127.0.0.1");
        } finally {
            await harness.dispose();
        }
    });
});
