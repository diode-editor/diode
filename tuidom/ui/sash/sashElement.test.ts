import { afterEach, describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../src/TestUtils/renderElement.ts";
import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import { MouseEventDispatcher } from "../../dom/events/mouseEventDispatcher.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import type { MouseToken } from "../../input/rawTerminalToken.ts";
import { TerminalScreen } from "../../rendering/terminalScreen.ts";

import { SashElement } from "./sashElement.ts";

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

function makeToken(overrides: Partial<MouseToken> & { action: MouseToken["action"] }): MouseToken {
    return {
        kind: "mouse",
        button: "left",
        x: 1,
        y: 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
        ...overrides,
    };
}

/** A sash at screenX=30 inside an 80-wide root, with a captured onDrag log. */
function buildScene(): { root: ContainerElement; sash: SashElement; drags: number[] } {
    const root = new ContainerElement();
    root.setAsRoot();
    root.localPosition = new Offset(0, 0);
    root.layout(BoxConstraints.tight(new Size(80, 24)));

    const sash = new SashElement();
    sash.localPosition = new Offset(30, 0);
    sash.layout(BoxConstraints.tight(new Size(1, 24)));
    root.addChild(sash);

    const drags: number[] = [];
    sash.onDrag = (x) => drags.push(x);

    return { root, sash, drags };
}

const HOVER_COLOR = 0x007fd4;

/** Render the sash standalone and return the character drawn in its top cell. */
function renderTopChar(sash: SashElement): string {
    const size = new Size(2, 3);
    const backend = new MockTerminalBackend(size);
    const termScreen = new TerminalScreen(size);
    sash.render(new RenderContext(termScreen, new Offset(0, 0), new Rect(new Point(0, 0), size)));
    termScreen.flush(backend);
    return backend.getTextAt(new Point(0, 0), 1);
}

describe("SashElement", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("opts into pointer capture and stays unfocusable", () => {
        const sash = new SashElement();
        expect(sash.capturesPointer).toBe(true);
        expect(sash.focusable).toBe(false);
    });

    it("renders nothing (invisible hit target)", () => {
        const sash = new SashElement();
        const backend = renderElement(sash, 10, 3, { constraints: BoxConstraints.tight(new Size(1, 3)) });

        // Nothing drawn — the boundary stays owned by the surrounding panels.
        expect(backend.getTextAt(new Point(0, 0), 1)).toBe(" ");
    });

    it("reports the absolute boundary column while dragging", () => {
        const { root, drags } = buildScene();
        const dispatcher = new MouseEventDispatcher();

        dispatcher.handleMouseToken(makeToken({ action: "press", x: 31, y: 1 }), root); // screenX 30
        dispatcher.handleMouseToken(makeToken({ action: "move", x: 41, y: 1 }), root); // screenX 40
        dispatcher.handleMouseToken(makeToken({ action: "move", x: 26, y: 1 }), root); // screenX 25
        dispatcher.handleMouseToken(makeToken({ action: "release", x: 26, y: 1 }), root);

        expect(drags).toEqual([40, 25]);
    });

    it("ignores moves that are not part of a left-button drag", () => {
        const { root, drags } = buildScene();
        const dispatcher = new MouseEventDispatcher();

        // A move with no prior mousedown must not trigger onDrag.
        dispatcher.handleMouseToken(makeToken({ action: "move", x: 41, y: 1 }), root);
        // A right-button press does not start a drag.
        dispatcher.handleMouseToken(makeToken({ action: "press", button: "right", x: 31, y: 1 }), root);
        dispatcher.handleMouseToken(makeToken({ action: "move", button: "right", x: 41, y: 1 }), root);

        expect(drags).toEqual([]);
    });

    it("stops reporting after the button is released", () => {
        const { root, sash, drags } = buildScene();
        const dispatcher = new MouseEventDispatcher();

        dispatcher.handleMouseToken(makeToken({ action: "press", x: 31, y: 1 }), root);
        dispatcher.handleMouseToken(makeToken({ action: "release", x: 31, y: 1 }), root);
        // Re-layout the sash to its (unchanged) spot, then move with no button held.
        sash.layout(BoxConstraints.tight(new Size(1, 24)));
        dispatcher.handleMouseToken(makeToken({ action: "move", x: 41, y: 1 }), root);

        expect(drags).toEqual([]);
    });

    it("paints the hover line only after the cursor lingers", () => {
        vi.useFakeTimers();
        const { root, sash } = buildScene();
        sash.hoverBorderColor = HOVER_COLOR;
        const dispatcher = new MouseEventDispatcher();

        // Cursor enters the sash (screenX 30) — line must not appear immediately.
        dispatcher.handleMouseToken(makeToken({ action: "move", x: 31, y: 1 }), root);
        expect(renderTopChar(sash)).toBe(" ");

        // After the hover delay elapses, the thin vertical line lights up.
        vi.advanceTimersByTime(300);
        expect(renderTopChar(sash)).toBe("│");
    });

    it("stays invisible without a hover color even after lingering", () => {
        vi.useFakeTimers();
        const { root, sash } = buildScene();
        const dispatcher = new MouseEventDispatcher();

        dispatcher.handleMouseToken(makeToken({ action: "move", x: 31, y: 1 }), root);
        vi.advanceTimersByTime(300);

        expect(renderTopChar(sash)).toBe(" ");
    });

    it("hides the line when the cursor leaves", () => {
        vi.useFakeTimers();
        const { root, sash } = buildScene();
        sash.hoverBorderColor = HOVER_COLOR;
        const dispatcher = new MouseEventDispatcher();

        dispatcher.handleMouseToken(makeToken({ action: "move", x: 31, y: 1 }), root);
        vi.advanceTimersByTime(300);
        expect(renderTopChar(sash)).toBe("│");

        // Move off the sash — the line goes out.
        dispatcher.handleMouseToken(makeToken({ action: "move", x: 50, y: 1 }), root);
        expect(renderTopChar(sash)).toBe(" ");
    });

    it("paints during a drag without waiting for the hover delay", () => {
        vi.useFakeTimers();
        const { root, sash } = buildScene();
        sash.hoverBorderColor = HOVER_COLOR;
        const dispatcher = new MouseEventDispatcher();

        dispatcher.handleMouseToken(makeToken({ action: "press", x: 31, y: 1 }), root);
        // No timer advance — the line shows immediately while dragging.
        expect(renderTopChar(sash)).toBe("│");

        dispatcher.handleMouseToken(makeToken({ action: "release", x: 31, y: 1 }), root);
        expect(renderTopChar(sash)).toBe(" ");
    });

    it("cancels the pending hover timer when the cursor leaves before the delay", () => {
        vi.useFakeTimers();
        const { root, sash } = buildScene();
        sash.hoverBorderColor = HOVER_COLOR;
        const dispatcher = new MouseEventDispatcher();

        // Enter the sash, then leave again before the hover delay elapses.
        dispatcher.handleMouseToken(makeToken({ action: "move", x: 31, y: 1 }), root);
        dispatcher.handleMouseToken(makeToken({ action: "move", x: 50, y: 1 }), root);

        // The pending timer was cancelled, so the line never lights even after the delay.
        vi.advanceTimersByTime(300);
        expect(renderTopChar(sash)).toBe(" ");
    });

    describe("horizontal orientation", () => {
        /** A horizontal sash at screenY=10 spanning an 80-wide root, with a drag log. */
        function buildHScene(): { root: ContainerElement; sash: SashElement; drags: number[] } {
            const root = new ContainerElement();
            root.setAsRoot();
            root.localPosition = new Offset(0, 0);
            root.layout(BoxConstraints.tight(new Size(80, 24)));

            const sash = new SashElement("horizontal");
            sash.localPosition = new Offset(0, 10);
            sash.layout(BoxConstraints.tight(new Size(80, 1)));
            root.addChild(sash);

            const drags: number[] = [];
            sash.onDrag = (y) => drags.push(y);
            return { root, sash, drags };
        }

        it("reports the absolute boundary row while dragging", () => {
            const { root, drags } = buildHScene();
            const dispatcher = new MouseEventDispatcher();

            dispatcher.handleMouseToken(makeToken({ action: "press", x: 5, y: 11 }), root); // screenY 10
            dispatcher.handleMouseToken(makeToken({ action: "move", x: 5, y: 16 }), root); // screenY 15
            dispatcher.handleMouseToken(makeToken({ action: "release", x: 5, y: 16 }), root);

            expect(drags).toEqual([15]);
        });

        it("paints a horizontal hover line", () => {
            vi.useFakeTimers();
            const { root, sash } = buildHScene();
            sash.hoverBorderColor = HOVER_COLOR;
            const dispatcher = new MouseEventDispatcher();

            dispatcher.handleMouseToken(makeToken({ action: "move", x: 5, y: 11 }), root);
            vi.advanceTimersByTime(300);
            expect(renderTopChar(sash)).toBe("─");
        });
    });
});
