import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";

// The subprocess installs the real proxy only after `activate()`; until then a stub
// holds the command. `activateEvents: []`: the command itself is the only activation trigger.
describe("ExtensionHost — activation by onCommand:<id>", () => {
    it("the command is in the registry before activation, and executing it activates the extension", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            initialFile: { name: "a.txt", content: "hello" },
            extensions: [
                {
                    ...extensionFixture("test.oncommand", "registersCommand.cjs"),
                    activationEvents: ["onCommand:test.applyTab"],
                },
            ],
        });
        try {
            expect(harness.host.hasExtension("test.oncommand")).toBe(false);
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);

            await expect(harness.commandRegistry.execute("test.applyTab", 7)).resolves.toBe("applied:7");
            expect(harness.host.hasExtension("test.oncommand")).toBe(true);
            expect(harness.group.getActiveEditor()?.viewState.tabSize).toBe(7);
        } finally {
            await harness.dispose();
        }
    });

    it("repeated execution goes straight to the proxy: no second activation", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            initialFile: { name: "a.txt", content: "hello" },
            extensions: [
                {
                    ...extensionFixture("test.twice", "registersCommand.cjs"),
                    activationEvents: ["onCommand:test.applyTab"],
                },
            ],
        });
        try {
            await expect(harness.commandRegistry.execute("test.applyTab", 3)).resolves.toBe("applied:3");
            expect(harness.host.extensionCount).toBe(1);
            await expect(harness.commandRegistry.execute("test.applyTab", 5)).resolves.toBe("applied:5");
            expect(harness.host.extensionCount).toBe(1);
        } finally {
            await harness.dispose();
        }
    });

    it("IMPLICIT event: a command from contributes.commands activates the extension without onCommand: in the manifest", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            initialFile: { name: "a.txt", content: "hello" },
            extensions: [
                {
                    ...extensionFixture("test.implicit", "registersCommand.cjs"),
                    // The only declared event never happens.
                    activationEvents: ["onLanguage:java"],
                    commandTitles: { "test.applyTab": "Apply Tab Size" },
                },
            ],
        });
        try {
            expect(harness.host.hasExtension("test.implicit")).toBe(false);
            await expect(harness.commandRegistry.execute("test.applyTab", 4)).resolves.toBe("applied:4");
            expect(harness.host.hasExtension("test.implicit")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("a title from contributes.commands makes the command visible in the command palette BEFORE activation", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.title", "registersCommand.cjs"),
                    activationEvents: ["onCommand:test.applyTab"],
                    commandTitles: { "test.applyTab": "Apply Tab Size" },
                },
            ],
        });
        try {
            expect(harness.host.hasExtension("test.title")).toBe(false);
            expect(harness.commandRegistry.listCommands()).toEqual([
                { id: "test.applyTab", title: "Apply Tab Size", enablement: undefined },
            ]);
        } finally {
            await harness.dispose();
        }
    });

    it("the category from contributes.commands sticks on both the stub and the live proxy", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.category", "registersCommand.cjs"),
                    activationEvents: ["onCommand:test.applyTab"],
                    commandTitles: { "test.applyTab": "Apply Tab Size" },
                    commandCategories: { "test.applyTab": "Test" },
                },
            ],
        });
        try {
            // Otherwise the label in the command palette would "jump" after the first run.
            expect(harness.host.hasExtension("test.category")).toBe(false);
            expect(harness.commandRegistry.listCommands()).toEqual([
                { id: "test.applyTab", title: "Apply Tab Size", enablement: undefined, category: "Test" },
            ]);

            await harness.commandRegistry.execute("test.applyTab", 4);
            await settle();
            expect(harness.host.hasExtension("test.category")).toBe(true);
            expect(harness.commandRegistry.listCommands()).toEqual([
                { id: "test.applyTab", title: "Apply Tab Size", enablement: undefined, category: "Test" },
            ]);
        } finally {
            await harness.dispose();
        }
    });

    it("a command without a title is executable but hidden from the command palette (like `_java.*`)", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.untitled", "registersCommand.cjs"),
                    activationEvents: ["onCommand:test.applyTab"],
                },
            ],
        });
        try {
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);
            expect(harness.commandRegistry.listCommands()).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("extension activated but did not register the command: the result is undefined, no loop", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.forgot", "noopExtension.cjs"),
                    activationEvents: ["onCommand:test.missing"],
                },
            ],
        });
        try {
            await expect(harness.commandRegistry.execute("test.missing")).resolves.toBeUndefined();
            expect(harness.host.hasExtension("test.forgot")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("a stub does not overwrite the live proxy of an active extension", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "hello" },
            extensions: [extensionFixture("test.active", "registersCommand.cjs")],
        });
        try {
            expect(harness.host.hasExtension("test.active")).toBe(true);
            harness.host.registerExtension({
                ...extensionFixture("test.latecomer", "noopExtension.cjs"),
                activationEvents: ["onCommand:test.applyTab"],
            });
            await settle();
            await expect(harness.commandRegistry.execute("test.applyTab", 6)).resolves.toBe("applied:6");
            expect(harness.host.hasExtension("test.latecomer")).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("removing the registration before activation removes the command from the registry", async () => {
        const harness = await createExtensionTestHarness({ activateEvents: [] });
        try {
            const disposable = harness.host.registerExtension({
                ...extensionFixture("test.removed", "registersCommand.cjs"),
                activationEvents: ["onCommand:test.applyTab"],
                commandTitles: { "test.applyTab": "Apply Tab Size" },
            });
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);
            disposable.dispose();
            expect(harness.commandRegistry.has("test.applyTab")).toBe(false);
            expect(harness.commandRegistry.listCommands()).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("removing a sibling does not close the door: two extensions declare the command", async () => {
        const harness = await createExtensionTestHarness({ activateEvents: [] });
        try {
            // An unrelated neighbor goes first, so the "who else declares this
            // command" lookup walks past an unrelated registration instead of finding it right away.
            harness.host.registerExtension({
                ...extensionFixture("test.zero", "noopExtension.cjs"),
                activationEvents: ["onStartupFinished"],
            });
            const first = harness.host.registerExtension({
                ...extensionFixture("test.one", "registersCommand.cjs"),
                activationEvents: ["onCommand:test.applyTab"],
                commandTitles: { "test.applyTab": "Apply Tab Size" },
            });
            harness.host.registerExtension({
                ...extensionFixture("test.two", "noopExtension.cjs"),
                activationEvents: ["onCommand:test.applyTab"],
            });

            first.dispose();
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("an unrelated sibling does not hold the door: the stub goes away with its owner", async () => {
        const harness = await createExtensionTestHarness({ activateEvents: [] });
        try {
            harness.host.registerExtension({
                ...extensionFixture("test.bystander", "noopExtension.cjs"),
                activationEvents: ["onCommand:test.other"],
            });
            const owner = harness.host.registerExtension({
                ...extensionFixture("test.owner", "registersCommand.cjs"),
                activationEvents: ["onCommand:test.applyTab"],
            });
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);

            owner.dispose();
            expect(harness.commandRegistry.has("test.applyTab")).toBe(false);
            expect(harness.commandRegistry.has("test.other")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("host dispose removes the stubs from the shared command registry", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.disposed", "registersCommand.cjs"),
                    activationEvents: ["onCommand:test.applyTab"],
                },
            ],
        });
        expect(harness.commandRegistry.has("test.applyTab")).toBe(true);
        await harness.dispose();
        expect(harness.commandRegistry.has("test.applyTab")).toBe(false);
    });

    it("activateByEvent('onCommand:<id>') activates the extension directly too", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.direct", "noopExtension.cjs"),
                    activationEvents: ["onLanguage:java"],
                    commandTitles: { "test.some": "Some" },
                },
            ],
        });
        try {
            await harness.host.activateByEvent("onCommand:test.some");
            await settle();
            expect(harness.host.hasExtension("test.direct")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });
});
