import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

import { createStatusBarHarness } from "./statusBarComponent.testUtils.ts";

const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);
const HOVER_BG = theme.getRequiredColor("statusBarItem.hoverBackground");
const HOVER_FG = theme.getRequiredColor("statusBarItem.hoverForeground");
const BAR_BG = theme.getRequiredColor("statusBar.background");

/** Mouse tokens are 1-based, screen coordinates are 0-based. */
function move(x: number, y: number): MouseToken {
    return {
        kind: "mouse",
        button: "none",
        x: x + 1,
        y: y + 1,
        action: "move",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

interface HoverHarness {
    app: TestApp;
    cellsOf: (text: string) => number[];
}

/** The terminal segment's text depends on env, so positions come from the actual label geometry. */
function setup(): HoverHarness {
    const harness = createStatusBarHarness();
    harness.statusBarService.addEntry({
        id: "alpha",
        name: "Alpha",
        text: "Alpha",
        alignment: "left",
        priority: 10,
        onClick: () => undefined,
    });
    harness.statusBarService.addEntry({ id: "beta", name: "Beta", text: "Beta", alignment: "left", priority: 5 });
    harness.statusBarService.addEntry({
        id: "gamma",
        name: "Gamma",
        text: "Gamma",
        alignment: "left",
        priority: 1,
        onClick: () => undefined,
    });
    const app = TestApp.createWithContent(harness.component.view, new Size(60, 1));
    app.render();

    const cellsOf = (text: string): number[] => {
        const label = harness.component.view
            .getChildren()
            .find(
                (child): child is TextLabelElement =>
                    child instanceof TextLabelElement && child.getText() === ` ${text} `,
            );
        if (!label) throw new Error(`status bar has no segment "${text}"`);
        const start = label.globalPosition.x;
        return Array.from({ length: label.layoutSize.width }, (_, i) => start + i);
    };

    return { app, cellsOf };
}

describe("StatusBarComponent hover", () => {
    it("a clickable segment under the mouse is painted with statusBarItem.hover*", () => {
        const { app, cellsOf } = setup();
        const cells = cellsOf("Alpha");

        app.backend.simulateMouse(move(cells[1], 0));
        app.render();

        // The highlight covers the edge spaces too: the whole segment block, not just the text.
        for (const x of cells) {
            expect(app.backend.getBgAt(new Point(x, 0))).toBe(HOVER_BG);
        }
        expect(app.backend.getFgAt(new Point(cells[1], 0))).toBe(HOVER_FG);
    });

    it("an inert segment under the mouse is not highlighted", () => {
        const { app, cellsOf } = setup();
        const cells = cellsOf("Beta");

        app.backend.simulateMouse(move(cells[1], 0));
        app.render();

        for (const x of cells) {
            expect(app.backend.getBgAt(new Point(x, 0))).toBe(BAR_BG);
        }
    });

    it("the mouse leaving the segment clears the highlight", () => {
        const { app, cellsOf } = setup();
        const cells = cellsOf("Alpha");

        app.backend.simulateMouse(move(cells[1], 0));
        app.render();
        expect(app.backend.getBgAt(new Point(cells[1], 0))).toBe(HOVER_BG);

        app.backend.simulateMouse(move(59, 0));
        app.render();
        expect(app.backend.getBgAt(new Point(cells[1], 0))).toBe(BAR_BG);
    });

    it("the highlight follows the mouse: a neighboring clickable segment takes it over", () => {
        const { app, cellsOf } = setup();
        const alpha = cellsOf("Alpha");
        const gamma = cellsOf("Gamma");

        app.backend.simulateMouse(move(alpha[1], 0));
        app.render();
        app.backend.simulateMouse(move(gamma[1], 0));
        app.render();

        expect(app.backend.getBgAt(new Point(gamma[1], 0))).toBe(HOVER_BG);
        expect(app.backend.getBgAt(new Point(alpha[1], 0))).toBe(BAR_BG);
    });
});
