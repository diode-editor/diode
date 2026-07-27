import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TUIKeyboardEvent } from "../../../../tuidom/dom/events/tuiKeyboardEvent.ts";
import type { EditorTabStripElement } from "../../../../tuidom/ui/editorgroup/editorTabStripElement.ts";
import type { HFlexElement } from "../../../../tuidom/ui/layout/hFlexElement.ts";
import type { QuickPickElement } from "../../../../tuidom/ui/quickpick/quickPickElement.ts";
import { createAppTestHarness } from "../../../TestUtils/AppTestHarness.ts";
import type { TestApp } from "../../../TestUtils/TestApp.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";
import { createTestContainer } from "../../vexx/modules/testProfile.ts";
import { TerminalEnvironmentServiceDIToken } from "../services/terminalEnvironment/node/terminalEnvironmentService.ts";

import { statusSegments, statusTexts } from "./parts/statusbar/statusBarComponent.testUtils.ts";
import { WorkbenchComponentDIToken } from "./workbenchComponent.ts";

describe("Workbench integration", () => {
    it("creates UI tree with menubar and editor", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/test-tree.txt");

        expect(h.testApp.querySelector("MenuBarElement")).not.toBeNull();
        expect(h.testApp.querySelector("ScrollBarDecorator")).not.toBeNull();
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
        // First part does not execute the command yet…
        expect(executeSpy).not.toHaveBeenCalledWith("workbench.action.files.save");
        // …and a waiting hint is shown in the status bar.
        expect(chordHints(h.testApp).some((t) => t.includes("Waiting"))).toBe(true);

        h.testApp.sendKey("s");
        expect(executeSpy).toHaveBeenCalledWith("workbench.action.files.save");
        // The continuation key must NOT be typed into the editor.
        expect(editorText(h.testApp)).toBe("");
    });

    it("a continuation key that matches no command is swallowed, not typed", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/chord-swallow.txt");
        h.workbench.focusEditor();
        const executeSpy = vi.spyOn(h.commands, "execute");

        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("x"); // not part of any chord

        expect(executeSpy).not.toHaveBeenCalledWith("workbench.action.files.save");
        expect(chordHints(h.testApp).some((t) => t.includes("Waiting"))).toBe(false);
        expect(editorText(h.testApp)).toBe(""); // 'x' did not leak
    });

    it("reports the unmatched combination in the status bar when a chord is not completed", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/chord-notfound.txt");
        h.workbench.focusEditor();

        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("x");

        expect(chordHints(h.testApp).some((t) => t.includes("(Ctrl+K X) is not a command"))).toBe(true);
    });

    it("the 'not a command' message auto-clears after the timeout", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/chord-notfound-clear.txt");
        h.workbench.focusEditor();

        vi.useFakeTimers();
        try {
            h.testApp.sendKey("Ctrl+K");
            h.testApp.sendKey("x");
            expect(chordHints(h.testApp).some((t) => t.includes("is not a command"))).toBe(true);

            vi.advanceTimersByTime(4000);
            expect(chordHints(h.testApp).some((t) => t.includes("is not a command"))).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("Ctrl+K then Ctrl+S breaks the chord and is consumed (no save, no leak)", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/chord-ctrls.txt");
        h.workbench.focusEditor();
        const executeSpy = vi.spyOn(h.commands, "execute");

        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Ctrl+S");

        expect(executeSpy).not.toHaveBeenCalledWith("workbench.action.files.save");
        expect(editorText(h.testApp)).toBe("");
    });

    it("resolves the chord through the full Kitty key lifecycle (down/up incl. release)", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/chord-kitty.txt");
        h.workbench.focusEditor();
        const executeSpy = vi.spyOn(h.commands, "execute");

        // Real terminal (Kitty protocol) sends CSI-u with explicit key releases.
        h.testApp.backend.sendRaw("\x1b[107;5u"); // Ctrl+K down
        h.testApp.backend.sendRaw("\x1b[107;5:3u"); // Ctrl+K up
        h.testApp.backend.sendRaw("\x1b[115u"); // s down
        h.testApp.backend.sendRaw("\x1b[115;1:3u"); // s up

        expect(executeSpy).toHaveBeenCalledWith("workbench.action.files.save");
        expect(editorText(h.testApp)).toBe(""); // 's' did not leak
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

            // Pending state was reset: 's' alone no longer completes the chord.
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
            // Broken chord arms the auto-clear timer for the "not a command" hint.
            h.testApp.sendKey("Ctrl+K");
            h.testApp.sendKey("x");
            expect(chordHints(h.testApp).some((t) => t.includes("is not a command"))).toBe(true);

            // The very next key dispatch clears that pending timer (and the hint) eagerly,
            // so when the original 4s timeout elapses there is no lingering message to reset.
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

        // Moving focus away while a chord is pending must abort it.
        const editor = h.testApp.querySelector("EditorElement") as EditorElement;
        editor.blur();

        expect(chordHints(h.testApp).some((t) => t.includes("Waiting"))).toBe(false);

        // The pending state was reset: 's' alone no longer completes the chord.
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
        // Over SSH/tmux/slow links a multi-byte key sequence can arrive in two reads.
        // The parser must buffer the partial first chunk and reassemble it, instead of
        // mis-tokenizing it as a lone Escape + literal characters (which would lose the
        // keypress and leak stray chars). Uses the showCommands sequence as a concrete example.
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

        // The app hosts persistent singleton pickers (quick-open + quick-input);
        // pressing Ctrl+P must reuse the quick-open one, never spawn a new element.
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

describe("Workbench — runtime extended-keys detection", () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        // Force a legacy baseline: tmux masks $TERM and ssh strips the kitty env flag,
        // so neither the term-name hint nor the env-flag hint fires.
        process.env.TERM = "tmux-256color";
        process.env.TMUX = "/tmp/tmux-1000/default,1,0";
        delete process.env.KITTY_WINDOW_ID;
        delete process.env.GHOSTTY_RESOURCES_DIR;
        delete process.env.WEZTERM_PANE;
        delete process.env.ALACRITTY_WINDOW_ID;
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

    it("promotes the tier off legacy when a CSI-u key arrives (e.g. Ctrl+Tab behind tmux)", () => {
        const { workbench, env } = mountWorkbench();
        expect(env.tier).toBe("legacy");

        workbench.view.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab", ctrlKey: true, raw: "\x1b[9;5u" }));

        expect(env.tier).toBe("csi-u");
        expect(env.hasCapability("extended-keys")).toBe(true);
    });

    it("leaves the tier at legacy for ordinary (non-CSI-u) keys", () => {
        const { workbench, env } = mountWorkbench();

        workbench.view.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a", raw: "a" }));

        expect(env.tier).toBe("legacy");
    });
});

describe("Workbench — completion wiring", () => {
    it("editor.action.triggerSuggest исполняется без ошибок", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/completion-trigger.txt");
        h.workbench.focusEditor();
        expect(() => h.commands.execute("editor.action.triggerSuggest")).not.toThrow();
    });
});
