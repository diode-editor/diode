import { BoxConstraints, Offset, Point, Rect, Size } from "@tuidom/core/common/geometryPromitives";
import { ROOT_STYLE_CONTEXT } from "@tuidom/core/dom/styles/tuiStyle";
import { RenderContext } from "@tuidom/core/dom/tuiElement";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { TerminalScreen } from "@tuidom/core/rendering/terminalScreen";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import { ViewWelcomeElement } from "./viewWelcomeElement.ts";

function mouse(app: TestApp, x: number, y: number): void {
    const token = (action: MouseToken["action"]): MouseToken => ({
        kind: "mouse",
        action,
        button: "left",
        x: x + 1,
        y: y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    });
    app.backend.simulateMouse(token("press"));
    app.backend.simulateMouse(token("release"));
}

// The default sidebar is 29 columns wide; stock hashicorp.terraform's Providers welcome (language server not
// answering) ends with the button `[Learn more about providers](https://…)`, whose frame is 30 columns.
const SCREEN = new Size(29, 6);

function frame(welcome: ViewWelcomeElement): string[] {
    const screen = new TerminalScreen(SCREEN);
    welcome.layout(BoxConstraints.tight(SCREEN));
    welcome.performStyleResolution(ROOT_STYLE_CONTEXT);
    welcome.render(new RenderContext(screen, new Offset(0, 0), new Rect(new Point(0, 0), SCREEN)));
    const rows: string[] = [];
    for (let y = 0; y < SCREEN.height; y++) {
        let line = "";
        for (let x = 0; x < SCREEN.width; x++) line += screen.getCell(new Point(x, y)).char;
        rows.push(line.trimEnd());
    }
    return rows;
}

describe("ViewWelcomeElement — a button wider than the section", () => {
    it("keeps its whole label on screen instead of cutting it at the edge (upstream buttons wrap)", () => {
        const welcome = new ViewWelcomeElement(
            [{ kind: "button", label: "Learn more about providers", url: "https://example.invalid/providers" }],
            () => {},
        );

        const rows = frame(welcome);
        const words = rows
            .join(" ")
            .split(/[\s[\]]+/)
            .filter(Boolean);

        // Actual: " [ Learn more about providers" — the closing bracket is cut off, the button looks broken.
        expect(words).toEqual(["Learn", "more", "about", "providers"]);
        expect(rows.join("\n")).toContain("]");
        for (const row of rows) expect(row.length).toBeLessThanOrEqual(SCREEN.width);
    });

    it("the text after it starts below its last row, and a click on any of its rows activates it", () => {
        const opened: unknown[] = [];
        const welcome = new ViewWelcomeElement(
            [
                { kind: "button", label: "Learn more about providers", command: "learn" },
                { kind: "text", text: "after" },
            ],
            (target) => opened.push(target),
        );

        expect(frame(welcome).slice(0, 3)).toEqual([" [ Learn more about", "   providers                ]", " after"]);
        const app = TestApp.createWithContent(welcome, SCREEN);
        app.render();
        mouse(app, 5, 1);
        mouse(app, 5, 2);
        expect(opened).toHaveLength(1);
    });
});
