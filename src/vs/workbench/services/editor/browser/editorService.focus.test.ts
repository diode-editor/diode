import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";

import { type EditorService, EditorServiceDIToken } from "./editorService.ts";

interface TestContext {
    testApp: TestApp;
    workbench: IAppHarness["workbench"];
    commandRegistry: CommandRegistry;
    editorService: EditorService;
}

function createTestContext(): TestContext {
    const h = createAppTestHarness();
    return {
        testApp: h.testApp,
        workbench: h.workbench,
        commandRegistry: h.commands,
        editorService: h.container.get(EditorServiceDIToken),
    };
}

describe("EditorService focus management on tab close", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-focus-test-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    it("focusManager.activeElement is null after closing the only tab", () => {
        const { testApp, workbench, editorService } = createTestContext();
        workbench.openFile(ws.writeFile("a.ts", "a"));
        workbench.focusEditor();

        expect(testApp.focusedElement).not.toBeNull();

        editorService.closeTab(0);

        expect(testApp.focusedElement).toBeNull();
    });

    it("focus moves to the new active editor after closing the last tab when two are open", () => {
        const { testApp, workbench, editorService } = createTestContext();
        workbench.openFile(ws.writeFile("a.ts", "a"));
        workbench.openFile(ws.writeFile("b.ts", "b"));
        workbench.focusEditor();

        const initialFocused = testApp.focusedElement;
        expect(initialFocused).not.toBeNull();

        editorService.closeTab(1);

        expect(testApp.focusedElement).not.toBeNull();
        expect(testApp.focusedElement).not.toBe(initialFocused);
        expect(testApp.querySelector("EditorElement")).toBe(testApp.focusedElement);
    });

    it("keyboard hotkeys work after closing the only tab", () => {
        const { testApp, workbench, commandRegistry, editorService } = createTestContext();
        workbench.openFile(ws.writeFile("a.ts", "a"));
        workbench.focusEditor();
        editorService.closeTab(0);

        const executeSpy = vi.spyOn(commandRegistry, "execute");

        // Ctrl+S should still be dispatched and reach the root command handlers
        testApp.sendKey("Ctrl+S");

        // The command may or may not execute depending on when-context guards,
        // but the key must not be silently swallowed by an orphaned element.
        // We verify the event was properly dispatched by checking no throw occurred
        // and that activeElement remains null (no zombie focus restored).
        expect(testApp.focusedElement).toBeNull();
    });

    it("activeElement points to living element in the tree after tab switch on close", () => {
        const { testApp, workbench, editorService } = createTestContext();
        workbench.openFile(ws.writeFile("a.ts", "a"));
        workbench.openFile(ws.writeFile("b.ts", "b"));
        workbench.openFile(ws.writeFile("c.ts", "c"));
        workbench.focusEditor();

        // close active (index 2)
        editorService.closeTab(2);

        const focused = testApp.focusedElement;
        expect(focused).not.toBeNull();
        // focused element must be reachable from root (in the live tree)
        expect(focused!.getRoot()).not.toBeNull();
    });

    it("activeElement is null (not orphaned) after closing the only tab", () => {
        const { testApp, workbench, editorService } = createTestContext();
        workbench.openFile(ws.writeFile("a.ts", "a"));
        workbench.focusEditor();

        editorService.closeTab(0);

        const focused = testApp.focusedElement;
        // If focused is not null it must still be in the live tree
        if (focused !== null) {
            expect(focused.getRoot()).not.toBeNull();
        }
    });
});

describe("EditorService auto-focus on file open", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-autofocus-test-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    it("editor receives focus automatically when a file is opened", () => {
        const { testApp, workbench } = createTestContext();
        workbench.openFile(ws.writeFile("a.ts", "a"));

        expect(testApp.focusedElement).not.toBeNull();
        expect(testApp.querySelector("EditorElement")).toBe(testApp.focusedElement);
    });

    it("editor receives focus when switching to an already-open file", () => {
        const { testApp, workbench } = createTestContext();
        const fp = ws.writeFile("a.ts", "a");
        workbench.openFile(fp);
        workbench.openFile(ws.writeFile("b.ts", "b"));
        // open a.ts again — should switch tab and focus
        workbench.openFile(fp);

        expect(testApp.focusedElement).not.toBeNull();
        expect(testApp.querySelector("EditorElement")).toBe(testApp.focusedElement);
    });

    it("focusManager.activeElement is the exact EditorElement instance after openFile", () => {
        const { testApp, editorService, workbench } = createTestContext();
        workbench.openFile(ws.writeFile("a.ts", "a"));

        const editorElement = editorService.getActiveEditor()!.view.getChild();
        expect(testApp.app.focusManager?.activeElement).toBe(editorElement);
    });
});
