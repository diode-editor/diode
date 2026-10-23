import { describe, expect, it, vi } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IStatusBarItemSink } from "../../../api/common/iExtensionWindowSinks.ts";
import type { IWireStatusBarItem } from "../../../api/common/wireTypes.ts";

/**
 * The extension host IPC runs Node's `serialization: "advanced"` (structured clone), which rejects a
 * function in the payload where JSON silently dropped it. The channel must then send the message as its
 * JSON image and say so: nothing an extension hands us is lost silently.
 */
describe("ExtensionHost — IPC payload the structured clone rejects (subprocess)", () => {
    it("a function inside status bar command arguments: the item arrives (function dropped, Uri and data kept), stderr carries the warning, the click round-trips", async () => {
        const updates: IWireStatusBarItem[] = [];
        const sink: IStatusBarItemSink = {
            update: (item) => updates.push(item),
            remove: () => undefined,
            clear: () => undefined,
        };
        const stderrLines: string[] = [];
        const stderrLogger = {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: (line: string) => stderrLines.push(line),
            error: (line: string) => stderrLines.push(line),
        } as unknown as ILogger;
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            statusBarItemSink: sink,
            stderrLogger,
            extensions: [extensionFixture("test.rawArgs", "statusBarRawArguments.cjs")],
        });
        try {
            await settle();
            const item = updates.at(-1);
            expect(item).toMatchObject({ text: "Raw", command: "test.rawArgs.click" });
            // The JSON image: the function slot is `null`, `Uri.toJSON()` components, the nested function gone.
            expect(item?.arguments).toEqual([
                expect.objectContaining({ scheme: "file", path: "/tmp/raw.ts" }),
                null,
                { nested: { keep: 2 } },
            ]);
            const warning = stderrLines.find((line) => line.includes("not structured-cloneable"));
            expect(warning).toContain("[ext-host]");
            expect(warning).toContain("notif window.statusBarItem.update");
            expect(warning).toContain("could not be cloned");

            // The click carries the stored arguments back to the extension over the same transport.
            await harness.commandRegistry.execute("test.rawArgs.click", ...(item?.arguments ?? []));
            await settle();
            expect(updates.at(-1)?.text).toBe("clicked:$mid,path,scheme|null|nested");
        } finally {
            await harness.dispose();
        }
    });
});
