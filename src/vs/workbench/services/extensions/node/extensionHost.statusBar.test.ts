import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { CommandServiceAdapter } from "../../../api/browser/commandServiceAdapter.ts";
import { ExtensionStatusBarAdapter } from "../../../api/browser/extensionStatusBarAdapter.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";

/**
 * The adapter comes before the harness: the item is set already in `activate()`. The command registry
 * does not exist yet then, so it is resolved lazily, at click time.
 */
async function makeHarness(withBridge = true) {
    const bar = new StatusBarService(NULL_STATE_SERVICE);
    let registry: CommandRegistry | null = null;
    const commands: ICommandService = {
        execute: (id, args) => new CommandServiceAdapter(assertRegistry(registry)).execute(id, args),
        holdInputUntil: () => undefined,
        listCommandIds: () => [],
        registerProxy: (id, invoke, title) =>
            new CommandServiceAdapter(assertRegistry(registry)).registerProxy(id, invoke, title),
    };
    const adapter = new ExtensionStatusBarAdapter(bar, commands);
    const harness = await createExtensionTestHarness({
        initialFile: { name: "main.ts", content: "x\n" },
        ...(withBridge ? { statusBarItemSink: adapter } : {}),
        extensions: [extensionFixture("test.statusBar", "createsStatusBarItem.cjs")],
    });
    registry = harness.commandRegistry;
    return { bar, harness };
}

function assertRegistry(registry: CommandRegistry | null): CommandRegistry {
    /* v8 ignore next -- defensive guard: by click time the harness is already built */
    if (registry === null) throw new Error("harness is not built yet");
    return registry;
}

function texts(bar: StatusBarService): string[] {
    return bar.entries().map((entry) => entry.text);
}

describe("ExtensionHost — extension status bar item (subprocess)", () => {
    it("an item created on activation shows in the bar; a click runs the extension command", async () => {
        const { bar, harness } = await makeHarness();
        try {
            await settle();
            const entry = bar.entries().at(0);
            expect(entry).toMatchObject({
                id: "extensions.test.statusBar.status-bar-demo",
                text: "Demo",
                alignment: "right",
                priority: 100,
                name: "Status Bar Demo",
            });

            entry?.onClick?.();
            await settle();
            expect(texts(bar)).toEqual(["Demo · clicked 1"]);

            bar.entries().at(0)?.onClick?.();
            await settle();
            expect(texts(bar)).toEqual(["Demo · clicked 2"]);
        } finally {
            await harness.dispose();
        }
    });

    it("the extension's hide/show/dispose are reflected in the bar immediately", async () => {
        const { bar, harness } = await makeHarness();
        try {
            await settle();
            expect(texts(bar)).toEqual(["Demo"]);

            await harness.commandRegistry.execute("test.statusBar.hide");
            await settle();
            expect(texts(bar)).toEqual([]);

            await harness.commandRegistry.execute("test.statusBar.show");
            await settle();
            expect(texts(bar)).toEqual(["Demo"]);

            await harness.commandRegistry.execute("test.statusBar.dispose");
            await settle();
            expect(texts(bar)).toEqual([]);

            // Editing a disposed item returns nothing and breaks nothing.
            await harness.commandRegistry.execute("test.statusBar.setText", "Demo 42");
            await settle();
            expect(texts(bar)).toEqual([]);

            await harness.commandRegistry.execute("test.statusBar.createLeft");
            await settle();
            expect(texts(bar)).toEqual(["L-high"]);
        } finally {
            await harness.dispose();
        }
    });

    it("subprocess death removes the extension's items; the next activation brings them back", async () => {
        const { bar, harness } = await makeHarness();
        try {
            await settle();
            bar.addEntry({ id: "status.editor.encoding", text: "UTF-8", alignment: "right", priority: 30 });
            expect(texts(bar)).toEqual(["Demo", "UTF-8"]);

            // `dispose` will not come from a crashed extension: only the host can remove the item.
            await harness.commandRegistry.execute("test.statusBar.kill");
            await settle(500);
            expect(texts(bar)).toEqual(["UTF-8"]);

            // `*` fired long ago for the survivor, so ANY event brings the subprocess back up.
            await harness.host.activateByEvent("onLanguage:markdown");
            await settle();
            expect(texts(bar)).toEqual(["Demo", "UTF-8"]);
        } finally {
            await harness.dispose();
        }
    });

    it("without a sink items are just dropped: host and extension stay alive", async () => {
        const { bar, harness } = await makeHarness(false);
        try {
            await settle();
            await expect(harness.commandRegistry.execute("test.statusBar.click")).resolves.toBe(1);
            expect(texts(bar)).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
