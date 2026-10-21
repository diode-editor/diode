import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createStatusBarHarness, statusSegments, statusTexts } from "./statusBarComponent.testUtils.ts";

describe("StatusBarComponent — indentation indicator", () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        delete process.env.TMUX;
        delete process.env.TMUX_PANE;
        delete process.env.SSH_CONNECTION;
        delete process.env.SSH_CLIENT;
        delete process.env.SSH_TTY;
        delete process.env.COLORTERM;
        delete process.env.KITTY_WINDOW_ID;
        delete process.env.GHOSTTY_RESOURCES_DIR;
        delete process.env.WEZTERM_PANE;
        delete process.env.ALACRITTY_WINDOW_ID;
        delete process.env.TERM_PROGRAM;
        process.env.TERM = "xterm-256color";
    });

    afterEach(() => {
        process.env = savedEnv;
    });

    it("no segment without an active editor", () => {
        const { component } = createStatusBarHarness();
        expect(statusSegments(component.view)).toEqual([{ text: "legacy", side: "left" }]);
    });

    it("tabs → 'Tab Size: N' from the current tab size", () => {
        const { component, source } = createStatusBarHarness();

        const editor = source.openEditor();
        editor.setIndentOptions({ insertSpaces: false, tabSize: 8 });

        expect(statusTexts(component.view)).toContain("Tab Size: 8");
    });

    it("spaces → 'Spaces: N', between Ln/Col and Encoding — VS Code order", () => {
        const { component, source } = createStatusBarHarness();

        const editor = source.openEditor();
        editor.setIndentOptions({ insertSpaces: true, tabSize: 2 });

        expect(statusTexts(component.view)).toEqual(["legacy", "Ln 1, Col 1", "Spaces: 2", "UTF-8", "LF", "plaintext"]);
    });

    it("detection from the open file's contents reaches the bar", () => {
        const { component, source } = createStatusBarHarness();

        source.openEditor("if (a) {\n  b();\n  c();\n}\n");

        expect(statusTexts(component.view)).toContain("Spaces: 2");
    });

    it("updates on the indentation change event without a manual update", () => {
        const { component, source } = createStatusBarHarness();
        const editor = source.openEditor();
        expect(statusTexts(component.view)).toContain("Tab Size: 4");

        // Partial patches: the configuration may send a single key.
        editor.setIndentOptions({ insertSpaces: true });
        expect(statusTexts(component.view)).toContain("Spaces: 4");

        editor.setIndentOptions({ tabSize: 3 });

        expect(statusTexts(component.view)).toContain("Spaces: 3");
        expect(statusTexts(component.view)).not.toContain("Tab Size: 4");
    });

    it("resubscribes when the active editor changes", () => {
        const { component, source } = createStatusBarHarness();
        const firstEditor = source.openEditor();
        source.openEditor();

        firstEditor.setIndentOptions({ insertSpaces: true, tabSize: 2 });
        expect(statusTexts(component.view)).toContain("Tab Size: 4");

        source.getActiveEditor()!.setIndentOptions({ insertSpaces: true, tabSize: 2 });
        expect(statusTexts(component.view)).toContain("Spaces: 2");
    });

    it("changing the active editor removes the indent subscription from the previous one", () => {
        const { source } = createStatusBarHarness();
        const firstEditor = source.openEditor();
        expect(firstEditor.indentListenerCount).toBe(1);

        source.openEditor();

        expect(firstEditor.indentListenerCount).toBe(0);
    });

    it("the segment is inert: no click (entries without onClick)", () => {
        const { statusBarService, source } = createStatusBarHarness();
        source.openEditor();

        const entry = statusBarService.entries().find((e) => e.id === "status.editor.indentation");
        expect(entry).toBeDefined();
        expect(entry!.onClick).toBeUndefined();
        expect(entry!.name).toBe("Editor Indentation");
    });
});
