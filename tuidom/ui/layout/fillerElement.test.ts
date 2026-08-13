import { describe, expect, it } from "vitest";

import { renderElement } from "../../testing/renderElement.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import { ROOT_STYLE_CONTEXT } from "../../dom/styles/tuiStyle.ts";
import { TerminalScreen } from "../../rendering/terminalScreen.ts";
import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";

import { FillerElement } from "./fillerElement.ts";

describe("FillerElement", () => {
    it("paints its whole rect with the explicit style", () => {
        const filler = new FillerElement();
        const fg = packRgb(10, 20, 30);
        const bg = packRgb(40, 50, 60);
        filler.style = { fg, bg };

        const backend = renderElement(filler, 5, 3, { resolveStyles: true });

        for (const point of [new Point(0, 0), new Point(4, 0), new Point(0, 2), new Point(4, 2), new Point(2, 1)]) {
            expect(backend.getBgAt(point)).toBe(bg);
            expect(backend.getFgAt(point)).toBe(fg);
        }
        expect(backend.screenToString().trim()).toBe("");
    });

    it("inherits fg/bg from the parent via style resolution", () => {
        const parent = new TUIElement();
        const fg = packRgb(1, 2, 3);
        const bg = packRgb(200, 100, 50);
        parent.style = { fg, bg };

        const filler = new FillerElement();
        parent.appendChild(filler);

        const size = new Size(4, 2);
        const backend = new MockTerminalBackend(size);
        const termScreen = new TerminalScreen(size);
        parent.localPosition = new Offset(0, 0);
        parent.layout(BoxConstraints.tight(size));
        filler.layout(BoxConstraints.tight(size));
        parent.performStyleResolution(ROOT_STYLE_CONTEXT);
        filler.render(new RenderContext(termScreen));
        termScreen.flush(backend);

        expect(backend.getBgAt(new Point(0, 0))).toBe(bg);
        expect(backend.getFgAt(new Point(3, 1))).toBe(fg);
    });

    it("does not paint outside its layout size", () => {
        const filler = new FillerElement();
        const bg = packRgb(90, 90, 90);
        filler.style = { fg: packRgb(0, 0, 0), bg };

        const size = new Size(6, 4);
        const backend = new MockTerminalBackend(size);
        const termScreen = new TerminalScreen(size);
        filler.localPosition = new Offset(0, 0);
        filler.layout(BoxConstraints.tight(new Size(3, 2)));
        filler.performStyleResolution(ROOT_STYLE_CONTEXT);
        filler.render(new RenderContext(termScreen));
        termScreen.flush(backend);

        expect(backend.getBgAt(new Point(2, 1))).toBe(bg);
        expect(backend.getBgAt(new Point(3, 0))).not.toBe(bg);
        expect(backend.getBgAt(new Point(0, 2))).not.toBe(bg);
    });

    it("asks for no space of its own (zero intrinsics)", () => {
        const filler = new FillerElement();
        expect(filler.getMinIntrinsicWidth(10)).toBe(0);
        expect(filler.getMaxIntrinsicWidth(10)).toBe(0);
        expect(filler.getMinIntrinsicHeight(10)).toBe(0);
        expect(filler.getMaxIntrinsicHeight(10)).toBe(0);
    });
});
