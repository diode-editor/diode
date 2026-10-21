import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";

import { createStatusBarHarness, statusSegments } from "./statusBarComponent.testUtils.ts";

describe("StatusBarComponent — language badge", () => {
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

    it("no badge without an active editor", () => {
        const { component } = createStatusBarHarness();
        expect(statusSegments(component.view)).toEqual([{ text: "legacy", side: "left" }]);
    });

    it("shows the display name from ILanguageService, badge to the right of Ln/Col", () => {
        const languageService: ILanguageService = {
            ...NULL_LANGUAGE_SERVICE,
            getLanguageIdForResource: () => undefined,
            getLanguageDisplayName: (id) => (id === "typescript" ? "TypeScript" : undefined),
        };
        const { component, source } = createStatusBarHarness(languageService);

        const editor = source.openEditor();
        editor.setLanguage("typescript");

        expect(statusSegments(component.view)).toEqual([
            { text: "legacy", side: "left" },
            { text: "Ln 1, Col 1", side: "right" },
            { text: "Tab Size: 4", side: "right" },
            { text: "UTF-8", side: "right" },
            { text: "LF", side: "right" },
            { text: "TypeScript", side: "right" },
        ]);
    });

    it("falls back to the raw language id without a display name", () => {
        const { component, source } = createStatusBarHarness();

        source.openEditor();

        expect(statusSegments(component.view)).toContainEqual({ text: "plaintext", side: "right" });
    });

    it("updates on setLanguage without a manual update", () => {
        const { component, source } = createStatusBarHarness();
        const editor = source.openEditor();

        editor.setLanguage("markdown");

        expect(statusSegments(component.view)).toContainEqual({ text: "markdown", side: "right" });
    });

    it("resubscribes when the active editor changes", () => {
        const { component, source } = createStatusBarHarness();
        const firstEditor = source.openEditor();
        source.openEditor();

        firstEditor.setLanguage("python");
        expect(statusSegments(component.view)).toContainEqual({ text: "plaintext", side: "right" });

        source.getActiveEditor()!.setLanguage("json");
        expect(statusSegments(component.view)).toContainEqual({ text: "json", side: "right" });
    });
});
