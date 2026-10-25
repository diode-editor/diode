import { BoxConstraints, Offset, Point, Rect, Size } from "@tuidom/core/common/geometryPromitives";
import { ROOT_STYLE_CONTEXT } from "@tuidom/core/dom/styles/tuiStyle";
import { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TerminalScreen } from "@tuidom/core/rendering/terminalScreen";
import { describe, expect, it } from "vitest";

import { ViewWelcomeElement } from "./viewWelcomeElement.ts";

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
});
