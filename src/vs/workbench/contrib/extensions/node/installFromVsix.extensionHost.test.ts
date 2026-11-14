import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { INSTALL_FROM_VSIX_COMMAND_ID, vsixPathsOf } from "../browser/extensionVsixActions.ts";

/** The extension's side of `installFromVSIX` over real RPC: what a `vscode.Uri` becomes, and how a refusal returns. */
describe("installFromVSIX from an extension (subprocess → host)", () => {
    it("the extension's `[Uri.file(path)]` arrives as a path the command can install", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.installsVsix", "installsVsix.cjs")],
        });
        try {
            const received: string[][] = [];
            harness.commandRegistry.register(INSTALL_FROM_VSIX_COMMAND_ID, (resources) => {
                received.push(vsixPathsOf(resources));
            });

            const answer = await harness.commandRegistry.execute("test.installVsix", "/tmp/codelldb-1-2.vsix");

            expect(answer).toBe("installed");
            expect(received).toEqual([["/tmp/codelldb-1-2.vsix"]]);
        } finally {
            await harness.dispose();
        }
    });

    it("a failed install rejects the extension's promise with the reason", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.installsVsix", "installsVsix.cjs")],
        });
        try {
            harness.commandRegistry.register(INSTALL_FROM_VSIX_COMMAND_ID, () =>
                Promise.reject(new Error("Not a valid .vsix (zip) archive: /tmp/x.vsix")),
            );

            const answer = await harness.commandRegistry.execute("test.installVsix", "/tmp/x.vsix");

            expect(answer).toBe("failed: Not a valid .vsix (zip) archive: /tmp/x.vsix");
        } finally {
            await harness.dispose();
        }
    });
});
