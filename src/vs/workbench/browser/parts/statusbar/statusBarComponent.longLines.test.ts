import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { STOP_RENDERING_LINE_AFTER } from "../../../../../../tuidom/common/textLimits.ts";
import { createInsertEdit } from "../../../../editor/common/core/iTextEdit.ts";

import { createStatusBarHarness } from "./statusBarComponent.testUtils.ts";

const LONG_LINES_TEXT = "⚠ Long lines";

describe("StatusBarComponent — long-lines indicator", () => {
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

    function texts(items: readonly { text: string }[]): string[] {
        return items.map((i) => i.text);
    }

    it("нет индикатора для обычного файла", () => {
        const { component, source } = createStatusBarHarness();
        source.openEditor("short\nlines");
        expect(texts(component.view.getItems())).not.toContain(LONG_LINES_TEXT);
    });

    it("показывает «Long lines» когда есть строка за порогом рендера", () => {
        const { component, source } = createStatusBarHarness();
        source.openEditor("x".repeat(STOP_RENDERING_LINE_AFTER + 1));
        expect(texts(component.view.getItems())).toContain(LONG_LINES_TEXT);
    });

    it("индикатор стоит правее сегмента языка", () => {
        const { component, source } = createStatusBarHarness();
        source.openEditor("y".repeat(STOP_RENDERING_LINE_AFTER + 1));
        const items = texts(component.view.getItems());
        expect(items.indexOf(LONG_LINES_TEXT)).toBeGreaterThan(items.indexOf("plaintext"));
    });

    it("появляется когда длинная строка дописана в уже открытый файл (Output)", () => {
        const { component, source } = createStatusBarHarness();
        const editor = source.openEditor("first line");
        expect(texts(component.view.getItems())).not.toContain(LONG_LINES_TEXT);

        editor.viewState.document.applyEdits([
            createInsertEdit(0, 10, "\n" + "z".repeat(STOP_RENDERING_LINE_AFTER + 5)),
        ]);
        expect(texts(component.view.getItems())).toContain(LONG_LINES_TEXT);
    });

    it("снимается когда длинная строка убрана", () => {
        const { component, source } = createStatusBarHarness();
        const editor = source.openEditor("keep\n" + "w".repeat(STOP_RENDERING_LINE_AFTER + 5));
        expect(texts(component.view.getItems())).toContain(LONG_LINES_TEXT);

        // Заменяем весь текст на короткий → индикатор исчезает.
        editor.viewState.document.setText("keep");
        expect(texts(component.view.getItems())).not.toContain(LONG_LINES_TEXT);
    });
});
