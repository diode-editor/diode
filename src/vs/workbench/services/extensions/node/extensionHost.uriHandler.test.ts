import { describe, expect, it, vi } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";
import { ExtensionUrlHandler } from "../common/extensionUrlHandler.ts";

describe("ExtensionHost — extension URI handlers (subprocess)", () => {
    it("URL to a lazy extension: activation by onUri, buffering and direct delivery", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [{ ...extensionFixture("Test.Uri", "uriHandler.cjs"), activationEvents: ["onUri:test.uri"] }],
            activateEvents: [],
        });
        const confirm = vi.fn(() => Promise.resolve(true));
        const handler = new ExtensionUrlHandler({
            handlers: harness.host.uriHandlers,
            activateByEvent: (event) => harness.host.activateByEvent(event),
            extensionDisplayName: () => "Uri Test",
            confirm,
            confirmedExtensionIds: () => [],
            notifyNotInstalled: () => undefined,
            logger: NULL_LOGGER,
        });
        try {
            expect(harness.host.hasExtension("Test.Uri")).toBe(false);
            await expect(handler.handleURL(Uri.parse("diode://test.uri/install-plugin?name=a%20b"))).resolves.toBe(
                true,
            );
            expect(harness.host.hasExtension("Test.Uri")).toBe(true);
            expect(harness.host.uriHandlers.has("test.uri")).toBe(true);
            await vi.waitFor(async () => {
                expect(await harness.commandRegistry.execute("test.uri.received")).toEqual([
                    { path: "/install-plugin", query: "name=a b" },
                ]);
            });

            await handler.handleURL(Uri.parse("diode://Test.Uri/second"), { trusted: true });
            expect(await harness.commandRegistry.execute("test.uri.received")).toEqual([
                { path: "/install-plugin", query: "name=a b" },
                { path: "/second", query: "" },
            ]);
            expect(confirm).toHaveBeenCalledOnce();

            expect(await harness.commandRegistry.execute("test.uri.registerAgain")).toBe(
                "Protocol handler already registered for extension Test.Uri",
            );
        } finally {
            handler.dispose();
            await harness.dispose();
        }
    });
});
