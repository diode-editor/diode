import { describe, expect, it, vi } from "vitest";

import { MockTerminalBackend } from "../backend/mockTerminalBackend.ts";
import { Point, Size } from "../common/geometryPromitives.ts";
import type { MouseToken } from "../input/rawTerminalToken.ts";
import { BodyElement } from "../ui/body/bodyElement.ts";

import { TuiApplication } from "./tuiApplication.ts";
import { RenderContext, TUIElement } from "./tuiElement.ts";

function moveMouse(x: number, y: number): MouseToken {
    return {
        kind: "mouse",
        button: "left",
        action: "move",
        x,
        y,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

// A leaf that paints a character whose value depends on a mutable field, so we can
// observe whether a render actually happened after an event.
class StatefulLeaf extends TUIElement {
    public mark = "A";

    public override render(context: RenderContext): void {
        context.setCell(0, 0, { char: this.mark });
    }
}

class SingleChildBody extends BodyElement {
    public readonly leaf = new StatefulLeaf();

    public constructor() {
        super();
        this.setContent(this.leaf);
    }
}

describe("TuiApplication — render loop (renderFrame / handleMouse / handleResize)", () => {
    it("renders the root on run() so initial content reaches the backend", () => {
        const backend = new MockTerminalBackend(new Size(5, 2));
        const app = new TuiApplication(backend);
        const body = new SingleChildBody();
        app.root = body;
        app.run();

        expect(backend.getTextAt(new Point(0, 0), 1)).toBe("A");
    });

    it("re-renders after a mouse token, reflecting state changed by a handler", () => {
        const backend = new MockTerminalBackend(new Size(5, 2));
        const app = new TuiApplication(backend);
        const body = new SingleChildBody();
        // Mutate the painted mark when the mouse moves over the body.
        // markDirty обязателен: кадр после ввода рисуется только по dirty-флагу.
        body.addEventListener("mousemove", () => {
            body.leaf.mark = "Z";
            body.leaf.markDirty();
        });
        app.root = body;
        app.run();

        expect(backend.getTextAt(new Point(0, 0), 1)).toBe("A");

        backend.simulateMouse(moveMouse(1, 1));

        // handleMouse dispatched the event AND called renderFrame() → new mark drawn.
        expect(backend.getTextAt(new Point(0, 0), 1)).toBe("Z");
    });

    it("clears stale content on every frame (screen.clear in renderFrame)", () => {
        const backend = new MockTerminalBackend(new Size(5, 2));
        const app = new TuiApplication(backend);
        const body = new SingleChildBody();
        app.root = body;
        app.run();

        expect(backend.getTextAt(new Point(0, 0), 1)).toBe("A");

        // Change the painted char and drive a key event: mark уже помечен
        // грязным, поэтому keydown-кадр проходит dirty-гейт и рисуется синхронно.
        body.leaf.mark = "B";
        body.leaf.markDirty();
        backend.sendKey("x");

        // The previous "A" was cleared and replaced by "B" — not overdrawn/left behind.
        expect(backend.getTextAt(new Point(0, 0), 1)).toBe("B");
    });

    it("resizes the screen and re-renders content at the new dimensions", () => {
        const backend = new MockTerminalBackend(new Size(3, 1));
        const app = new TuiApplication(backend);
        const body = new SingleChildBody();
        app.root = body;
        app.run();

        const renderSpy = vi.spyOn(backend, "renderFrame");
        renderSpy.mockClear();

        backend.resize(new Size(8, 4));

        // handleResize replaced the screen, re-laid out, and rendered once.
        expect(app.screen.width).toBe(8);
        expect(app.screen.height).toBe(4);
        expect(renderSpy).toHaveBeenCalledTimes(1);
        expect(body.layoutSize.width).toBe(8);
        // Content still drawn after resize.
        expect(backend.getTextAt(new Point(0, 0), 1)).toBe("A");
    });
});
