import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";

// Like the VS Code extension host (`--dns-result-order=ipv4first`): Java clients connect
// to 127.0.0.1, and a server on `::1` does not exist for them.
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
