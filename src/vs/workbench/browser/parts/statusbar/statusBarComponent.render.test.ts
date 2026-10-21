import { Point } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderElement } from "../../../../../../src/TestUtils/renderElement.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

import { createStatusBarHarness } from "./statusBarComponent.testUtils.ts";

/** Each segment carries a space on both edges, so neighbors are separated by exactly two — as in VS Code. */
const LEFT_TEXT = " legacy ";
const RIGHT_TEXT = " Ln 1, Col 1  Tab Size: 4  UTF-8  LF  plaintext ";

describe("StatusBarComponent — frame", () => {
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

    function renderLine(width: number, openFile = true): string {
        const harness = createStatusBarHarness();
        if (openFile) harness.source.openEditor();
        const backend = renderElement(harness.component.view, width, 1, { themeVars: true });
        return backend.screenToString().split("\n")[0];
    }

    it("padding at the edges, left segments on the left, right ones pushed to the right edge", () => {
        const line = renderLine(62);
        // 1 (padL) + left segment + centerFill + right group + 1 (padR) = 62.
        const fill = " ".repeat(62 - 1 - LEFT_TEXT.length - RIGHT_TEXT.length - 1);
        expect(line).toBe(` ${LEFT_TEXT}${fill}${RIGHT_TEXT} `);
    });

    it("without an open file — only the left segment on the bar background", () => {
        const line = renderLine(20, false);
        expect(line).toBe(` ${LEFT_TEXT}` + " ".repeat(20 - 1 - LEFT_TEXT.length));
    });

    it("the whole bar background is the theme's statusBar.background, including padding and the middle", () => {
        const harness = createStatusBarHarness();
        harness.source.openEditor();
        const backend = renderElement(harness.component.view, 45, 1, { themeVars: true });

        const bg = WorkbenchTheme.fromThemeFile(darkPlusTheme).getRequiredColor("statusBar.background");
        for (const x of [0, 3, 8, 20, 44]) {
            expect(backend.getBgAt(new Point(x, 0))).toBe(bg);
        }
    });

    it("when width runs out the right group loses its alignment and is clipped by the screen edge", () => {
        const line = renderLine(30);
        // centerFill collapses to 0; the tail runs past the edge and is clipped.
        expect(line).toBe(` ${LEFT_TEXT}${RIGHT_TEXT} `.slice(0, 30));
    });
});
