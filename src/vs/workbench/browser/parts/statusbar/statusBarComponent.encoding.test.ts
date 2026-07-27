import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";

import { clickSegment, createStatusBarHarness, statusTexts } from "./statusBarComponent.testUtils.ts";
import type { StatusBarComponent } from "./statusBarComponent.ts";

function itemTexts(component: StatusBarComponent): string[] {
    return statusTexts(component.view);
}

describe("StatusBarComponent — encoding & EOL segments", () => {
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

    it("без активного редактора сегментов Encoding/EOL нет", () => {
        const { component } = createStatusBarHarness();
        expect(itemTexts(component)).toEqual(["legacy"]);
    });

    it("порядок правых сегментов как в VS Code: Ln/Col · Encoding · EOL · Language", () => {
        const { component, source } = createStatusBarHarness();
        source.openEditor();

        expect(itemTexts(component)).toEqual(["legacy", "Ln 1, Col 1", "UTF-8", "LF", "plaintext"]);
    });

    it("сегмент кодировки показывает statusLabel и трекает setEncoding без ручного обновления", () => {
        const { component, source } = createStatusBarHarness();
        const editor = source.openEditor();

        editor.setEncoding("windows1251");

        expect(itemTexts(component)).toContain("Windows 1251");
    });

    it("сегмент EOL трекает setEol без ручного обновления", () => {
        const { component, source } = createStatusBarHarness();
        const editor = source.openEditor();

        editor.setEol(EndOfLine.CRLF);

        expect(itemTexts(component)).toContain("CRLF");
        expect(itemTexts(component)).not.toContain("LF");
    });

    it("клик по сегментам исполняет команды changeEncoding / changeEOL", () => {
        const { component, source, commands } = createStatusBarHarness();
        source.openEditor();

        const executed: string[] = [];
        commands.register("workbench.action.editor.changeEncoding", () => executed.push("enc"));
        commands.register("workbench.action.editor.changeEOL", () => executed.push("eol"));

        clickSegment(component.view, "UTF-8");
        clickSegment(component.view, "LF");

        expect(executed).toEqual(["enc", "eol"]);
    });

    it("переподписывается при смене активного редактора", () => {
        const { component, source } = createStatusBarHarness();
        const firstEditor = source.openEditor();
        source.openEditor();

        // Смена кодировки НЕактивного редактора сегмент не трогает.
        firstEditor.setEncoding("koi8r");
        expect(itemTexts(component)).toContain("UTF-8");

        // Смена у активного — обновляет.
        source.getActiveEditor()!.setEncoding("windows1251");
        expect(itemTexts(component)).toContain("Windows 1251");
    });
});
