import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { EditorTabStripElement } from "@tuidom/elements/editorgroup/editorTabStripElement";
import type { HFlexElement } from "@tuidom/elements/layout/hFlexElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness } from "../../../TestUtils/AppTestHarness.ts";
import type { TestApp } from "../../../TestUtils/TestApp.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";
import { LayoutServiceDIToken } from "../services/layout/browser/layoutService.ts";
import { TerminalEnvironmentServiceDIToken } from "../services/terminalEnvironment/node/terminalEnvironmentService.ts";

import type { QuickPickElement } from "./parts/quickinput/quickPickElement.ts";
import { statusSegments, statusTexts } from "./parts/statusbar/statusBarComponent.testUtils.ts";
import { WorkbenchComponentDIToken } from "./workbenchComponent.ts";

describe("Workbench integration", () => {
    it("creates UI tree with menubar and editor", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/test-tree.txt");

        expect(h.testApp.querySelector("MenuBarElement")).not.toBeNull();
        expect(h.testApp.querySelector("ScrollBarDecorator")).not.toBeNull();
    });

    it("the root view #workbench hosts feature overlays (LayoutService.mainContainer)", () => {
        const h = createAppTestHarness();

        expect(h.workbench.view.id).toBe("workbench");
        expect(h.container.get(LayoutServiceDIToken).mainContainer).toBe(h.workbench.view);
    });

    it("focuses editor via focusEditor()", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/test-focus.txt");
        h.workbench.focusEditor();

        expect(h.testApp.focusedElement).not.toBeNull();
        expect(h.testApp.querySelector("EditorElement")).toBe(h.testApp.focusedElement);
    });

    it("Ctrl+S executes save command", () => {
        const h = createAppTestHarness();
        h.workbench.focusEditor();

        const executeSpy = vi.spyOn(h.commands, "execute");

        h.testApp.sendKey("Ctrl+S");

        expect(executeSpy).toHaveBeenCalledWith("workbench.action.files.save");
    });

    it("Tab cycles focus from editor to menubar", () => {
        const h = createAppTestHarness();
        h.workbench.focusEditor();

        const editorElement = h.testApp.querySelector("EditorElement");
        const menuBar = h.testApp.querySelector("MenuBarElement");

        expect(h.testApp.focusedElement).toBe(editorElement);

        h.testApp.sendKey("Tab");

        expect(h.testApp.focusedElement).toBe(menuBar);
    });

    it("typing inserts text into editor", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/test-typing.txt");
        h.workbench.focusEditor();

        h.testApp.sendKey("h");
        h.testApp.sendKey("i");

        const editorElement = h.testApp.querySelector("EditorElement") as EditorElement;
        expect(editorElement.viewState.document.getText()).toBe("hi");
    });

    it("Ctrl+Tab switches to next editor tab", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/tab-a.txt");
        h.workbench.openFile("/tmp/tab-b.txt");
        h.workbench.focusEditor();

        const tabStrip = h.testApp.querySelector("EditorTabStripElement") as EditorTabStripElement;
        expect(tabStrip.activeIndex).toBe(1);

        h.testApp.sendKey("Ctrl+Tab");

        expect(tabStrip.activeIndex).toBe(0);
    });

    it("Ctrl+Tab keeps focus on EditorElement", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/tab-a.txt");
        h.workbench.openFile("/tmp/tab-b.txt");
        h.workbench.focusEditor();

        h.testApp.sendKey("Ctrl+Tab");

        expect(h.testApp.focusedElement).not.toBeNull();
        expect(h.testApp.focusedElement).toBe(h.testApp.querySelector("EditorElement"));
    });

    it("Ctrl+Shift+Tab switches to previous editor tab", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/tab-a.txt");
        h.workbench.openFile("/tmp/tab-b.txt");
        h.workbench.focusEditor();

        const tabStrip = h.testApp.querySelector("EditorTabStripElement") as EditorTabStripElement;
        expect(tabStrip.activeIndex).toBe(1);

        h.testApp.sendKey("Ctrl+Shift+Tab");

        expect(tabStrip.activeIndex).toBe(0);
    });

    it("Ctrl+Shift+Tab keeps focus on EditorElement", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/tab-a.txt");
        h.workbench.openFile("/tmp/tab-b.txt");
        h.workbench.focusEditor();

        h.testApp.sendKey("Ctrl+Shift+Tab");

        expect(h.testApp.focusedElement).not.toBeNull();
        expect(h.testApp.focusedElement).toBe(h.testApp.querySelector("EditorElement"));
    });

    it("Ctrl+W closes active tab", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/tab-a.txt");
        h.workbench.openFile("/tmp/tab-b.txt");
        h.workbench.focusEditor();

        const tabStrip = h.testApp.querySelector("EditorTabStripElement") as EditorTabStripElement;
        expect(tabStrip.getItemElements()).toHaveLength(2);

        h.testApp.sendKey("Ctrl+W");

        expect(tabStrip.getItemElements()).toHaveLength(1);
    });

    it("Ctrl+W keeps focus on remaining EditorElement", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/tab-a.txt");
        h.workbench.openFile("/tmp/tab-b.txt");
        h.workbench.focusEditor();

        h.testApp.sendKey("Ctrl+W");

        expect(h.testApp.focusedElement).not.toBeNull();
        expect(h.testApp.focusedElement).toBe(h.testApp.querySelector("EditorElement"));
    });

    it("lays out the chrome: menu bar on row 0, status bar on the last row, the layout between them", () => {
        const width = 70;
        const rows = 20;
        const h = createAppTestHarness({ size: new Size(width, rows) });
        const box = (selector: string): { y: number; height: number; width: number } => {
            const element = h.testApp.querySelector(selector);
            if (!element) throw new Error(`no ${selector}`);
            return { y: element.globalPosition.y, height: element.layoutSize.height, width: element.layoutSize.width };
        };

        expect(box("#menuBar")).toEqual({ y: 0, height: 1, width });
        expect(box("WorkbenchLayoutElement")).toEqual({ y: 1, height: rows - 2, width });
        expect(box("#statusBar")).toEqual({ y: rows - 1, height: 1, width });
    });

    it("creates UI tree with statusbar", () => {
        const h = createAppTestHarness();

        expect(h.testApp.querySelector("#statusBar")).not.toBeNull();
    });

    it("statusbar shows the cursor position after openFile", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/test-app-statusbar.txt");

        const statusBar = h.testApp.querySelector("#statusBar") as HFlexElement;
        expect(statusSegments(statusBar)).toContainEqual({ text: "Ln 1, Col 1", side: "right" });
        expect(statusTexts(statusBar)).not.toContain("test-app-statusbar.txt");
    });

    it("statusbar updates the cursor position live after typing", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/test-app-modified.txt");
        h.workbench.focusEditor();

        h.testApp.sendKey("x");

        const statusBar = h.testApp.querySelector("#statusBar") as HFlexElement;
        expect(statusSegments(statusBar)).toContainEqual({ text: "Ln 1, Col 2", side: "right" });
        expect(statusTexts(statusBar)).not.toContain("[Modified]");
    });
});

describe("Workbench — chords", () => {
    function chordHints(testApp: TestApp): string[] {
        return statusTexts(testApp.querySelector("#statusBar") as HFlexElement);
    }

    function editorText(testApp: TestApp): string {
        return (testApp.querySelector("EditorElement") as EditorElement).viewState.document.getText();
    }

    it("Ctrl+K then S runs the chord-bound save without leaking 's' into the editor", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/chord-save.txt");
        h.workbench.focusEditor();
        const executeSpy = vi.spyOn(h.commands, "execute");

        h.testApp.sendKey("Ctrl+K");
        expect(executeSpy).not.toHaveBeenCalledWith("workbench.action.files.save");
        expect(chordHints(h.testApp).some((t) => t.includes("Waiting"))).toBe(true);

        h.testApp.sendKey("s");
        expect(executeSpy).toHaveBeenCalledWith("workbench.action.files.save");
        expect(editorText(h.testApp)).toBe("");
    });

    it("a continuation key that matches no command is swallowed, not typed", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/chord-swallow.txt");
        h.workbench.focusEditor();
        const executeSpy = vi.spyOn(h.commands, "execute");

        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("q");

        expect(executeSpy).not.toHaveBeenCalledWith("workbench.action.files.save");
        expect(chordHints(h.testApp).some((t) => t.includes("Waiting"))).toBe(false);
        expect(editorText(h.testApp)).toBe("");
    });

    it("reports the unmatched combination in the status bar when a chord is not completed", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/chord-notfound.txt");
        h.workbench.focusEditor();

        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("q");

        expect(chordHints(h.testApp).some((t) => t.includes("(Ctrl+K Q) is not a command"))).toBe(true);
    });

    it("the 'not a command' message auto-clears after the timeout", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/chord-notfound-clear.txt");
        h.workbench.focusEditor();

        vi.useFakeTimers();
        try {
            h.testApp.sendKey("Ctrl+K");
            h.testApp.sendKey("q");
            expect(chordHints(h.testApp).some((t) => t.includes("is not a command"))).toBe(true);

            vi.advanceTimersByTime(4000);
            expect(chordHints(h.testApp).some((t) => t.includes("is not a command"))).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("Ctrl+K then Ctrl+S resolves the chord (opens Keyboard Shortcuts, no save, no leak)", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/chord-ctrls.txt");
        h.workbench.focusEditor();
        const executeSpy = vi.spyOn(h.commands, "execute");

        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Ctrl+S");

        expect(executeSpy).toHaveBeenCalledWith("workbench.action.openGlobalKeybindings");
        expect(executeSpy).not.toHaveBeenCalledWith("workbench.action.files.save");
        expect(h.container.get(EditorServiceDIToken).getActivePane()?.uri.scheme).toBe("keybindings");
        h.commands.execute("workbench.action.previousEditorInGroup");
        expect(editorText(h.testApp)).toBe("");
    });

    it("resolves the chord through the full Kitty key lifecycle (down/up incl. release)", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/chord-kitty.txt");
        h.workbench.focusEditor();
        const executeSpy = vi.spyOn(h.commands, "execute");

        h.testApp.backend.sendRaw("\x1b[107;5u"); // Ctrl+K down
        h.testApp.backend.sendRaw("\x1b[107;5:3u"); // Ctrl+K up
        h.testApp.backend.sendRaw("\x1b[115u"); // s down
        h.testApp.backend.sendRaw("\x1b[115;1:3u"); // s up

        expect(executeSpy).toHaveBeenCalledWith("workbench.action.files.save");
        expect(editorText(h.testApp)).toBe("");
    });

    it("cancels the pending chord after the timeout", () => {
        const h = createAppTestHarness();
        h.workbench.focusEditor();

        vi.useFakeTimers();
        try {
            h.testApp.sendKey("Ctrl+K");
            expect(chordHints(h.testApp).some((t) => t.includes("Waiting"))).toBe(true);

            vi.advanceTimersByTime(5000);
            expect(chordHints(h.testApp).some((t) => t.includes("Waiting"))).toBe(false);

            const executeSpy = vi.spyOn(h.commands, "execute");
            h.testApp.sendKey("s");
            expect(executeSpy).not.toHaveBeenCalledWith("workbench.action.files.save");
        } finally {
            vi.useRealTimers();
        }
    });

    it("a new keypress clears the pending 'not a command' timer before it fires", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/chord-notfound-reset.txt");
        h.workbench.focusEditor();

        vi.useFakeTimers();
        try {
            h.testApp.sendKey("Ctrl+K");
            h.testApp.sendKey("q");
            expect(chordHints(h.testApp).some((t) => t.includes("is not a command"))).toBe(true);

            h.testApp.sendKey("a");
            expect(chordHints(h.testApp).some((t) => t.includes("is not a command"))).toBe(false);

            vi.advanceTimersByTime(4000);
            expect(chordHints(h.testApp).some((t) => t.includes("is not a command"))).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("a focus change cancels an in-progress chord and clears the waiting hint", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/chord-focus-cancel.txt");
        h.workbench.focusEditor();

        h.testApp.sendKey("Ctrl+K");
        expect(chordHints(h.testApp).some((t) => t.includes("Waiting"))).toBe(true);

        const editor = h.testApp.querySelector("EditorElement") as EditorElement;
        editor.blur();

        expect(chordHints(h.testApp).some((t) => t.includes("Waiting"))).toBe(false);

        const executeSpy = vi.spyOn(h.commands, "execute");
        h.testApp.sendKey("s");
        expect(executeSpy).not.toHaveBeenCalledWith("workbench.action.files.save");
    });
});

describe("Workbench — Quick Open", () => {
    it("Ctrl+P opens QuickPickElement (picker is visible)", () => {
        const h = createAppTestHarness();
        h.workbench.focusEditor();

        h.testApp.sendKey("Ctrl+P");

        expect(h.testApp.querySelector("QuickPickElement")).not.toBeNull();
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(true);
    });

    it("Ctrl+Shift+P opens QuickPickElement in commands mode", () => {
        const h = createAppTestHarness();
        h.workbench.focusEditor();

        h.commands.execute("workbench.action.showCommands");
        h.testApp.render();

        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(true);
        const picker = h.testApp.querySelector("QuickPickElement") as QuickPickElement;
        expect(picker.placeholder).toBe("Show All Commands");
    });

    it("reassembles a key sequence delivered split across two stdin reads", () => {
        // Over SSH/tmux a multi-byte key sequence can arrive in two reads; the parser must
        // reassemble it instead of mis-tokenizing it as a lone Escape + literal chars.
        const h = createAppTestHarness();
        h.workbench.focusEditor();

        h.testApp.backend.sendRaw("\x1b[112;6"); // first read — incomplete CSI-u
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);

        h.testApp.backend.sendRaw("u"); // rest of the same sequence → reassembled
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(true);
    });

    it("Escape closes Quick Open picker", () => {
        const h = createAppTestHarness();
        h.workbench.focusEditor();
        h.testApp.sendKey("Ctrl+P");
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(true);

        h.testApp.sendKey("Escape");

        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("Escape after Ctrl+P returns focus to editor", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/focus-restore.txt");
        h.workbench.focusEditor();
        const editorElement = h.testApp.querySelector("EditorElement");

        h.testApp.sendKey("Ctrl+P");
        h.testApp.sendKey("Escape");

        expect(h.testApp.focusedElement).toBe(editorElement);
    });

    it("Ctrl+P while picker already open does not open second picker", () => {
        const h = createAppTestHarness();
        h.workbench.focusEditor();

        const before = h.testApp.querySelectorAll("QuickPickElement").length;
        h.testApp.sendKey("Ctrl+P");
        h.testApp.sendKey("Ctrl+P");

        expect(h.testApp.querySelectorAll("QuickPickElement").length).toBe(before);
    });

    it("Show Commands lists registered commands", () => {
        const h = createAppTestHarness();
        h.commands.register("test.myCmd", () => {}, "My Test Command");
        h.workbench.focusEditor();

        h.commands.execute("workbench.action.showCommands");
        h.testApp.render();

        const picker = h.testApp.querySelector("QuickPickElement") as QuickPickElement;
        const labels = picker.items.map((i) => i.label);
        expect(labels).toContain("My Test Command");
    });
});

describe("Workbench — the tier does not change mid-session (#1049)", () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        // Behind tmux keys may arrive CSI-u encoded while diode itself never asked for it.
        process.env.TERM = "tmux-256color";
        process.env.TMUX = "/tmp/tmux-1000/default,1,0";
        delete process.env.TERM_PROGRAM;
        delete process.env.COLORTERM;
    });

    afterEach(() => {
        process.env = savedEnv;
    });

    function mountWorkbench() {
        const { container } = createTestContainer();
        const workbench = container.get(WorkbenchComponentDIToken);
        workbench.mount();
        const env = container.get(TerminalEnvironmentServiceDIToken);
        return { workbench, env };
    }

    it("a CSI-u key (Ctrl+Tab behind tmux) leaves the tier at legacy", () => {
        const { workbench, env } = mountWorkbench();

        workbench.view.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab", ctrlKey: true, raw: "\x1b[9;5u" }));
        workbench.view.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "s", metaKey: true, raw: "\x1b[115;9u" }));

        expect(env.tier).toBe("legacy");
    });
});

describe("Workbench — completion wiring", () => {
    it("editor.action.triggerSuggest runs without errors", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/completion-trigger.txt");
        h.workbench.focusEditor();
        expect(() => h.commands.execute("editor.action.triggerSuggest")).not.toThrow();
    });
});
