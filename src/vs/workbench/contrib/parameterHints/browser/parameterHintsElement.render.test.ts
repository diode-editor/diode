import { BoxConstraints, Offset, Point, Rect, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { ROOT_STYLE_CONTEXT } from "@tuidom/core/dom/styles/tuiStyle";
import { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TerminalScreen } from "@tuidom/core/rendering/terminalScreen";
import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../../../../TestUtils/expectScreen.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

import { type IParameterHint, ParameterHintsElement } from "./parameterHintsElement.ts";

const vars = computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));

function hint(patch: Partial<IParameterHint> = {}): IParameterHint {
    return {
        label: "greet(name: string): void",
        activeSpan: [6, 18],
        counter: null,
        documentation: [],
        ...patch,
    };
}

function render(element: ParameterHintsElement) {
    const width = element.getMinIntrinsicWidth(0);
    const height = element.getMinIntrinsicHeight(width);
    return renderElement(element, width, height, { themeVars: true });
}

/** Manual render into `TerminalScreen`: `MockTerminalBackend` keeps only text and colors, no style flags. */
function renderToScreen(element: ParameterHintsElement): TerminalScreen {
    const size = new Size(element.getMinIntrinsicWidth(0), element.getMinIntrinsicHeight(0));
    const termScreen = new TerminalScreen(size);
    element.localPosition = new Offset(0, 0);
    element.layout(BoxConstraints.tight(size));
    element.setStyleVars(vars);
    element.performStyleResolution(ROOT_STYLE_CONTEXT);
    element.render(new RenderContext(termScreen, new Offset(0, 0), new Rect(new Point(0, 0), size)));
    return termScreen;
}

describe("ParameterHintsElement — layout", () => {
    it("border + signature: width follows the label, minimum 20", () => {
        const element = new ParameterHintsElement();
        element.setHint(hint());

        // Max intrinsics equal min: the popup does not stretch (the overlay layer reads them).
        expect(element.getMaxIntrinsicWidth(0)).toBe(element.getMinIntrinsicWidth(0));
        expect(element.getMaxIntrinsicHeight(0)).toBe(element.getMinIntrinsicHeight(0));
        expectScreen(
            render(element),
            screen`
                ╭───────────────────────────╮
                │ greet(name: string): void │
                ╰───────────────────────────╯
            `,
        );
    });

    it("the overload counter is on the left, the wrapped label continues under it", () => {
        const element = new ParameterHintsElement();
        element.maxWidth = 26;
        element.setHint(hint({ label: "greet(name: string, age: number): void", counter: "1/2" }));

        expectScreen(
            render(element),
            screen`
                ╭────────────────────────╮
                │ 1/2 greet(name:        │
                │     string, age:       │
                │     number): void      │
                ╰────────────────────────╯
            `,
        );
    });

    it("a short signature stretches the popup to the minimum width", () => {
        const element = new ParameterHintsElement();
        element.setHint(hint({ label: "f()", activeSpan: [0, 0] }));

        // MIN_WIDTH = 20: the popup is never narrower, otherwise the border sticks to the text.
        expect(element.getMinIntrinsicWidth(0)).toBe(20);
        expectScreen(
            render(element),
            screen`
                ╭──────────────────╮
                │ f()              │
                ╰──────────────────╯
            `,
        );
    });

    it("the counter widens the popup instead of eating into the label", () => {
        const withCounter = new ParameterHintsElement();
        withCounter.setHint(hint({ counter: "1/2" }));
        const without = new ParameterHintsElement();
        without.setHint(hint());

        // "1/2 " is four columns on top of the label, otherwise the signature would have to wrap.
        expect(withCounter.getMinIntrinsicWidth(0)).toBe(without.getMinIntrinsicWidth(0) + 4);
        expect(withCounter.linesFor(60)).toEqual(["1/2 greet(name: string): void"]);
    });

    it("content lines: label, empty separator, documentation", () => {
        const element = new ParameterHintsElement();
        element.setHint(hint({ documentation: ["who to greet"] }));

        expect(element.isEmpty).toBe(false);
        // The separator is an empty line in the model: the renderer takes its width from the frame.
        expect(element.linesFor(40)).toEqual(["greet(name: string): void", "", "who to greet"]);
    });

    it("documentation goes below a separator, one separator per block", () => {
        const element = new ParameterHintsElement();
        element.setHint(hint({ documentation: ["name: who to greet", "Greets a person."] }));

        expectScreen(
            render(element),
            screen`
                ╭───────────────────────────╮
                │ greet(name: string): void │
                │ ───────────────────────── │
                │ name: who to greet        │
                │ ───────────────────────── │
                │ Greets a person.          │
                ╰───────────────────────────╯
            `,
        );
    });

    it("an empty documentation block draws no dangling separator", () => {
        const element = new ParameterHintsElement();
        element.setHint(hint({ documentation: ["", "   "] }));

        expect(element.linesFor(30)).toEqual(["greet(name: string): void"]);
    });

    it("height is clamped: extra documentation lines are cut, the border stays intact", () => {
        const element = new ParameterHintsElement();
        element.maxWidth = 30;
        element.maxHeight = 5;
        element.setHint(hint({ documentation: ["one two three four five six seven eight"] }));

        // Four lines of content, but only three fit inside the border.
        expect(element.linesFor(26)).toHaveLength(4);
        expect(element.getMinIntrinsicHeight(0)).toBe(5);
        expectScreen(
            render(element),
            screen`
                ╭────────────────────────────╮
                │ greet(name: string): void  │
                │ ────────────────────────── │
                │ one two three four five    │
                ╰────────────────────────────╯
            `,
        );
    });

    it("without a hint the element takes no space and does not crash on render", () => {
        const element = new ParameterHintsElement();
        element.setHint(null);

        expect(element.isEmpty).toBe(true);
        expect(element.getMinIntrinsicWidth(0)).toBe(0);
        expect(element.getMinIntrinsicHeight(0)).toBe(0);
        expect(element.linesFor(30)).toEqual([]);
        expect(() => renderElement(element, 4, 4, { themeVars: true })).not.toThrow();
    });

    it("does not take focus — the popup lives alongside the active editor", () => {
        expect(new ParameterHintsElement().focusable).toBe(false);
    });
});

describe("ParameterHintsElement — colors", () => {
    it("border, background and text use the editorHoverWidget.* tokens", () => {
        const element = new ParameterHintsElement();
        element.setHint(hint());
        const backend = render(element);

        expect(backend.getFgAt(new Point(0, 0))).toBe(vars["editorHoverWidget.border"]);
        expect(backend.getBgAt(new Point(2, 1))).toBe(vars["editorHoverWidget.background"]);
        // "g" of greet is plain text, not the active parameter.
        expect(backend.getFgAt(new Point(2, 1))).toBe(vars["editorHoverWidget.foreground"]);
    });

    it("the active parameter is highlightForeground and bold, its neighbors are untouched", () => {
        const element = new ParameterHintsElement();
        // greet(name: string): void
        //       ^ 6              ^ 18 (end is exclusive)
        element.setHint(hint({ activeSpan: [6, 18] }));
        const backend = render(element);
        const width = element.getMinIntrinsicWidth(0);
        const nameX = backend.getTextAt(new Point(0, 1), width).indexOf("name");

        expect(backend.getFgAt(new Point(nameX, 1))).toBe(vars["editorHoverWidget.highlightForeground"]);
        expect(renderToScreen(element).getCell(new Point(nameX, 1)).style & StyleFlags.Bold).toBe(StyleFlags.Bold);
        // The paren before the parameter is outside the range.
        expect(backend.getFgAt(new Point(nameX - 1, 1))).toBe(vars["editorHoverWidget.foreground"]);
        // So is the character right after the range (`)` in `string)`).
        expect(backend.getFgAt(new Point(nameX + 12, 1))).toBe(vars["editorHoverWidget.foreground"]);
    });

    it("the highlight moves to the wrapped line, the counter and indent are not highlighted", () => {
        const element = new ParameterHintsElement();
        element.maxWidth = 26;
        const label = "greet(name: string, age: number): void";
        element.setHint(hint({ label, counter: "1/2", activeSpan: [20, 31] }));
        const backend = render(element);

        // Second label line: `    string, age:` — only `age:` is highlighted.
        const second = backend.getTextAt(new Point(0, 2), element.getMinIntrinsicWidth(0));
        const ageX = second.indexOf("age");
        expect(backend.getFgAt(new Point(ageX, 2))).toBe(vars["editorHoverWidget.highlightForeground"]);
        expect(backend.getFgAt(new Point(2, 2))).toBe(vars["editorHoverWidget.foreground"]);
        expect(backend.getFgAt(new Point(2, 1))).toBe(vars["editorHoverWidget.foreground"]);
    });

    it("the background is filled where there is no text too — the editor does not show through the popup", () => {
        const element = new ParameterHintsElement();
        element.setHint(hint());
        const backend = render(element);
        const width = element.getMinIntrinsicWidth(0);

        // Right padding column: no character, but the background must be the popup's.
        expect(backend.getTextAt(new Point(width - 2, 1), 1)).toBe(" ");
        expect(backend.getBgAt(new Point(width - 2, 1))).toBe(vars["editorHoverWidget.background"]);
    });

    it("the separator line is drawn in the border color", () => {
        const element = new ParameterHintsElement();
        element.setHint(hint({ documentation: ["who to greet"] }));
        const backend = render(element);

        expect(backend.getTextAt(new Point(2, 2), 3)).toBe("───");
        expect(backend.getFgAt(new Point(2, 2))).toBe(vars["editorHoverWidget.border"]);
    });

    it("documentation is not highlighted even when the range covers offset zero", () => {
        const element = new ParameterHintsElement();
        // Range [0, 5] is the start of the LABEL; documentation lines have nothing to do with the label.
        element.setHint(hint({ activeSpan: [0, 5], documentation: ["who to greet"] }));
        const backend = render(element);

        expect(backend.getFgAt(new Point(2, 1))).toBe(vars["editorHoverWidget.highlightForeground"]);
        expect(backend.getFgAt(new Point(2, 3))).toBe(vars["editorHoverWidget.foreground"]);
    });

    it("the highlight takes the first character of the wrapped line but not the indent under the counter", () => {
        const element = new ParameterHintsElement();
        element.maxWidth = 26;
        const label = "greet(name: string, age: number): void";
        // The parameter `name: string` (offsets 6–18) is split by wrapping: its tail
        // `string` starts on the second line, at offset 12.
        element.setHint(hint({ label, counter: "1/2", activeSpan: [6, 18] }));
        const backend = render(element);

        expect(backend.getTextAt(new Point(6, 2), 6)).toBe("string");
        expect(backend.getFgAt(new Point(6, 2))).toBe(vars["editorHoverWidget.highlightForeground"]);
        for (const x of [2, 3, 4, 5]) {
            expect(backend.getFgAt(new Point(x, 2))).toBe(vars["editorHoverWidget.foreground"]);
        }
        expect(backend.getFgAt(new Point(12, 2))).toBe(vars["editorHoverWidget.foreground"]);
    });

    it("an empty range highlights nothing", () => {
        const element = new ParameterHintsElement();
        element.setHint(hint({ activeSpan: [0, 0] }));
        const backend = render(element);

        expect(backend.getFgAt(new Point(2, 1))).toBe(vars["editorHoverWidget.foreground"]);
        expect(renderToScreen(element).getCell(new Point(2, 1)).style & StyleFlags.Bold).toBe(0);
    });
});
