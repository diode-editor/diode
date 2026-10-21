import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import type { IOutputSink } from "../../../../workbench/api/common/iExtensionWindowSinks.ts";

// Without `vscode.TreeItem` the extension module failed to load, without
// `registerTreeDataProvider` it failed in `activate()`: the user lost the whole extension.
describe("ExtensionHost — an extension with a tree activates fully", () => {
    it("a module with `extends vscode.TreeItem` loads, and a command after the tree registration runs", async () => {
        const output: { channel: string; level: string; value: string }[] = [];
        const outputSink: IOutputSink = {
            append: (channel, _label, level, value) => {
                output.push({ channel, level, value });
            },
            show: () => undefined,
        };
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.treeOutline", "treeOutlineExtension.cjs")],
            outputSink,
        });
        try {
            await settle();
            expect(harness.host.hasExtension("test.treeOutline")).toBe(true);
            // The default None (0) matches upstream; ThemeIcon arrived as a value.
            expect(await harness.commandRegistry.execute("test.treeTargets")).toEqual([
                "//app:main:0:play",
                "//lib:greeter:0:play",
            ]);
            expect(output).toEqual([
                {
                    channel: "extensions",
                    level: "warn",
                    value: expect.stringMatching(
                        /^tree view "test\.targets" is not rendered in TUI yet/,
                    ) as unknown as string,
                },
            ]);
        } finally {
            await harness.dispose();
        }
    });
});
