import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it, vi } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { QuickInputExtensionAdapter } from "../../../api/browser/quickInputExtensionAdapter.ts";
import { QuickInputComponent } from "../../../browser/parts/quickinput/quickInputComponent.ts";
import { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";

// No stub "human": the answer comes from the real widget driven by keys.

async function setup() {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    const harness = await createExtensionTestHarness({
        initialFile: { name: "main.go", content: "package main\n" },
        extensions: [extensionFixture("test.asksForQuickPick", "asksForQuickPick.cjs")],
        quickInputSink: new QuickInputExtensionAdapter(service),
    });
    const view = (): Record<string, unknown> => component.view.inspectState();
    const type = (text: string): void => {
        for (const ch of text) testApp.sendKey(ch);
    };
    return { harness, component, testApp, view, type };
}

describe("ExtensionHost — window.createQuickPick through a real subprocess", () => {
    it("a lazy list (golang.go's pickLazyEnum shape): items after show, search, Enter", async () => {
        const { harness, component, testApp, view, type } = await setup();
        try {
            const result = harness.commandRegistry.execute("test.lazyPick") as Promise<{
                value: string | undefined;
                log: string[];
            }>;
            // The picker opened empty; the items arrived with the next diff.
            await vi.waitFor(() => {
                expect(view()).toMatchObject({
                    title: "Lazy enum",
                    items: ["Alpha module", "Beta module", "Gamma"],
                });
            });
            expect(component.view.placeholder).toBe("Type to search modules");
            // detail takes the description's place on a single-line row.
            expect(component.view.items[0]).toMatchObject({ description: "example.com/alpha" });

            // Query "beta": the extension receives the value and re-requests the
            // items itself; the host's label filter lets them through too.
            type("beta");
            await vi.waitFor(() => {
                expect(component.view.prompt).toBe("results for beta");
            });
            expect(view()).toMatchObject({ query: "beta", items: ["Beta module"] });
            testApp.sendKey("Enter");

            const { value, log } = await result;
            expect(value).toBe("example.com/beta");
            expect(log).toEqual(expect.arrayContaining(["value:beta", "selection:Beta module", "accept"]));
            // The extension hides the picker itself, via its own hide(), not via Enter.
            await vi.waitFor(() => {
                expect(component.isOpen()).toBe(false);
            });
        } finally {
            await harness.dispose();
        }
    });

    it("Escape fires onDidHide in the extension, the command gets `nothing`", async () => {
        const { harness, component, testApp, view } = await setup();
        try {
            const result = harness.commandRegistry.execute("test.lazyPick") as Promise<{
                value: string | undefined;
                log: string[];
            }>;
            await vi.waitFor(() => {
                expect(view()).toMatchObject({ items: ["Alpha module", "Beta module", "Gamma"] });
            });
            testApp.sendKey("Escape");
            const { value, log } = await result;
            expect(value).toBeUndefined();
            // Two, as upstream: Escape fires onDidHide, and dispose() in its
            // handler (as golang.go does) fires the second one (extHostQuickPick.ts).
            expect(log).toEqual(["hide", "hide"]);
            expect(component.isOpen()).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("multi-select: preselection, the separator is not drawn, steps in the title, own objects come back", async () => {
        const { harness, testApp, view } = await setup();
        try {
            const result = harness.commandRegistry.execute("test.pickManyObject") as Promise<{
                picked: string[];
                same: boolean;
            }>;
            await vi.waitFor(() => {
                expect(view()).toMatchObject({
                    title: "Pick numbers (1/2)",
                    items: ["one", "two", "three"],
                    checked: ["two"],
                });
            });
            testApp.sendKey("ArrowDown");
            testApp.sendKey("ArrowDown");
            testApp.sendKey("ArrowDown");
            testApp.sendKey(" ");
            // The check mark travels as an event; Enter must find it already at the extension.
            await vi.waitFor(() => {
                expect(view()).toMatchObject({ checked: ["two", "three"] });
            });
            testApp.sendKey("Enter");
            await expect(result).resolves.toEqual({ picked: ["two", "three"], same: true });
        } finally {
            await harness.dispose();
        }
    });

    it("the extension's hide() closes the overlay, onDidHide fires exactly once", async () => {
        const { harness, component } = await setup();
        try {
            await harness.commandRegistry.execute("test.showForHide");
            await vi.waitFor(() => {
                expect(component.isOpen()).toBe(true);
            });
            await expect(harness.commandRegistry.execute("test.hideShown")).resolves.toEqual({ hides: 1 });
            expect(component.isOpen()).toBe(false);
        } finally {
            await harness.dispose();
        }
    });
});
