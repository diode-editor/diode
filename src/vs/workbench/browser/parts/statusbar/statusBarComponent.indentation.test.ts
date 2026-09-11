import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createStatusBarHarness, statusSegments, statusTexts } from "./statusBarComponent.testUtils.ts";

describe("StatusBarComponent — индикатор отступов", () => {
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

    it("нет сегмента без активного редактора", () => {
        const { component } = createStatusBarHarness();
        expect(statusSegments(component.view)).toEqual([{ text: "legacy", side: "left" }]);
    });

    it("табы → «Tab Size: N» по действующему размеру таба", () => {
        const { component, source } = createStatusBarHarness();

        const editor = source.openEditor();
        editor.setIndentOptions({ insertSpaces: false, tabSize: 8 });

        expect(statusTexts(component.view)).toContain("Tab Size: 8");
    });

    it("пробелы → «Spaces: N», между Ln/Col и Encoding — порядок VS Code", () => {
        const { component, source } = createStatusBarHarness();

        const editor = source.openEditor();
        editor.setIndentOptions({ insertSpaces: true, tabSize: 2 });

        expect(statusTexts(component.view)).toEqual(["legacy", "Ln 1, Col 1", "Spaces: 2", "UTF-8", "LF", "plaintext"]);
    });

    it("детекция по содержимому открытого файла доезжает до полосы", () => {
        const { component, source } = createStatusBarHarness();

        // Файл с двухпробельными отступами: детекция в конструкторе view-state.
        source.openEditor("if (a) {\n  b();\n  c();\n}\n");

        expect(statusTexts(component.view)).toContain("Spaces: 2");
    });

    it("обновляется по событию смены отступов без ручного апдейта", () => {
        const { component, source } = createStatusBarHarness();
        const editor = source.openEditor();
        expect(statusTexts(component.view)).toContain("Tab Size: 4");

        // Частичные патчи — как из настоящих источников (конфиг может прислать
        // один ключ): сначала вид отступа, затем размер.
        editor.setIndentOptions({ insertSpaces: true });
        expect(statusTexts(component.view)).toContain("Spaces: 4");

        editor.setIndentOptions({ tabSize: 3 });

        expect(statusTexts(component.view)).toContain("Spaces: 3");
        expect(statusTexts(component.view)).not.toContain("Tab Size: 4");
    });

    it("переподписывается при смене активного редактора", () => {
        const { component, source } = createStatusBarHarness();
        const firstEditor = source.openEditor();
        source.openEditor();

        // Смена отступов НЕактивного редактора полосу не трогает.
        firstEditor.setIndentOptions({ insertSpaces: true, tabSize: 2 });
        expect(statusTexts(component.view)).toContain("Tab Size: 4");

        // Смена отступов активного — обновляет.
        source.getActiveEditor()!.setIndentOptions({ insertSpaces: true, tabSize: 2 });
        expect(statusTexts(component.view)).toContain("Spaces: 2");
    });

    it("смена активного редактора снимает indent-подписку с прежнего", () => {
        const { source } = createStatusBarHarness();
        const firstEditor = source.openEditor();
        expect(firstEditor.indentListenerCount).toBe(1);

        source.openEditor();

        expect(firstEditor.indentListenerCount).toBe(0);
    });

    it("сегмент инертен: клик не предусмотрен (записи без onClick)", () => {
        const { statusBarService, source } = createStatusBarHarness();
        source.openEditor();

        const entry = statusBarService.entries().find((e) => e.id === "status.editor.indentation");
        expect(entry).toBeDefined();
        expect(entry!.onClick).toBeUndefined();
        expect(entry!.name).toBe("Editor Indentation");
    });
});
