import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";

import { createStatusBarHarness, statusSegments } from "./statusBarComponent.testUtils.ts";

describe("StatusBarComponent — language badge", () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        // Детерминированное окружение: сегмент терминала — "legacy" без модов.
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

    it("нет беджика без активного редактора", () => {
        const { component } = createStatusBarHarness();
        expect(statusSegments(component.view)).toEqual([{ text: "legacy", side: "left" }]);
    });

    it("показывает display name из ILanguageService, беджик правее Ln/Col", () => {
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
            { text: "UTF-8", side: "right" },
            { text: "LF", side: "right" },
            { text: "TypeScript", side: "right" },
        ]);
    });

    it("откатывается на сырой language id без display name", () => {
        const { component, source } = createStatusBarHarness();

        source.openEditor();

        expect(statusSegments(component.view)).toContainEqual({ text: "plaintext", side: "right" });
    });

    it("обновляется на setLanguage без ручного обновления", () => {
        const { component, source } = createStatusBarHarness();
        const editor = source.openEditor();

        editor.setLanguage("markdown");

        expect(statusSegments(component.view)).toContainEqual({ text: "markdown", side: "right" });
    });

    it("переподписывается при смене активного редактора", () => {
        const { component, source } = createStatusBarHarness();
        const firstEditor = source.openEditor();
        source.openEditor();

        // Смена языка НЕактивного редактора беджик не трогает.
        firstEditor.setLanguage("python");
        expect(statusSegments(component.view)).toContainEqual({ text: "plaintext", side: "right" });

        // Смена языка активного — обновляет.
        source.getActiveEditor()!.setLanguage("json");
        expect(statusSegments(component.view)).toContainEqual({ text: "json", side: "right" });
    });
});
