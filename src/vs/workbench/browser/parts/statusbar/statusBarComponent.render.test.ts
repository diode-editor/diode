import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderElement } from "../../../../../../src/TestUtils/renderElement.ts";
import { Point } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

import { createStatusBarHarness } from "./statusBarComponent.testUtils.ts";

/** Правые сегменты после открытия файла, через 2-пробельные разделители. */
const RIGHT_TEXT = "Ln 1, Col 1  UTF-8  LF  plaintext";

describe("StatusBarComponent — кадр", () => {
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

    function renderLine(width: number, openFile = true): string {
        const harness = createStatusBarHarness();
        if (openFile) harness.source.openEditor();
        const backend = renderElement(harness.component.view, width, 1, { themeVars: true });
        return backend.screenToString().split("\n")[0];
    }

    it("паддинги по краям, левые сегменты слева, правые прижаты к правому краю", () => {
        const line = renderLine(45);
        // 1 (padL) + "legacy" + centerFill + правая группа + 1 (padR) = 45.
        const fill = " ".repeat(45 - 1 - "legacy".length - RIGHT_TEXT.length - 1);
        expect(line).toBe(` legacy${fill}${RIGHT_TEXT} `);
    });

    it("без открытого файла — только левый сегмент на фоне полосы", () => {
        const line = renderLine(20, false);
        expect(line).toBe(" legacy" + " ".repeat(13));
    });

    it("фон всей полосы — statusBar.background темы, включая паддинги и середину", () => {
        const harness = createStatusBarHarness();
        harness.source.openEditor();
        const backend = renderElement(harness.component.view, 45, 1, { themeVars: true });

        const bg = WorkbenchTheme.fromThemeFile(darkPlusTheme).getRequiredColor("statusBar.background");
        for (const x of [0, 3, 8, 20, 44]) {
            expect(backend.getBgAt(new Point(x, 0))).toBe(bg);
        }
    });

    it("при нехватке ширины правая группа теряет выравнивание и обрезается краем экрана", () => {
        const line = renderLine(30);
        // centerFill схлопывается в 0: правая группа идёт сразу за левой,
        // хвост (вместе с правым паддингом) уезжает за край и клипуется.
        expect(line).toBe(` legacy${RIGHT_TEXT} `.slice(0, 30));
    });
});
