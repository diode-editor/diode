import { describe, expect, it, vi } from "vitest";

import { MockTerminalBackend } from "../backend/mockTerminalBackend.ts";
import { Point, Size } from "../common/geometryPromitives.ts";
import type { MouseToken } from "../input/rawTerminalToken.ts";
import { BodyElement } from "../ui/body/bodyElement.ts";
import { InputElement } from "../ui/inputbox/inputElement.ts";

import { TuiApplication } from "./tuiApplication.ts";
import { TUIElement } from "./tuiElement.ts";

// Container exposing two focusable child inputs for focus-cycling tests.
class TwoInputContainer extends TUIElement {
    public readonly first = new InputElement();
    public readonly second = new InputElement();

    public constructor() {
        super();
        this.appendChild(this.first);
        this.appendChild(this.second);
    }
}

function pressMouse(x: number, y: number): MouseToken {
    return {
        kind: "mouse",
        button: "left",
        action: "press",
        x,
        y,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

describe("TuiApplication — input routing", () => {
    it("routes key input to the focused element, mutating its state", () => {
        const backend = new MockTerminalBackend(new Size(20, 1));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const input = new InputElement();
        body.setContent(input);
        app.root = body;
        app.run();

        input.focus();
        expect(input.isFocused).toBe(true);

        backend.sendKey("h");
        backend.sendKey("i");

        expect(input.inputState.value).toBe("hi");
        // Rendered text reflects the typed value.
        expect(backend.getTextAt(new Point(0, 0), 2)).toBe("hi");
    });

    it("routes a bracketed paste to the focused element as one insertion", () => {
        const backend = new MockTerminalBackend(new Size(20, 1));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const input = new InputElement();
        body.setContent(input);
        app.root = body;
        app.run();

        input.focus();
        backend.sendPaste("hello");

        expect(input.inputState.value).toBe("hello");
    });

    it("falls back to root dispatch for a paste when nothing is focused", () => {
        const backend = new MockTerminalBackend(new Size(20, 1));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const handler = vi.fn();
        body.addEventListener("paste", handler);
        app.root = body;
        app.run();

        backend.sendPaste("data");

        expect(handler).toHaveBeenCalled();
    });

    it("falls back to root dispatch when nothing is focused", () => {
        const backend = new MockTerminalBackend(new Size(20, 1));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const handler = vi.fn();
        body.addEventListener("keydown", handler);
        app.root = body;
        app.run();

        backend.sendKey("a");

        expect(handler).toHaveBeenCalled();
    });

    it("cycles focus forward on Tab when not prevented", () => {
        const backend = new MockTerminalBackend(new Size(40, 3));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const container = new TwoInputContainer();
        body.setContent(container);
        app.root = body;
        app.run();

        container.first.focus();
        expect(container.first.isFocused).toBe(true);

        backend.sendKey("Tab");

        // Focus cycles forward to the second focusable input.
        expect(container.second.isFocused).toBe(true);
        expect(container.first.isFocused).toBe(false);
    });
});

// A focusable leaf that relies on the base-class default action (focus on mousedown).
class FocusableLeaf extends TUIElement {
    public constructor() {
        super();
        this.tabIndex = 0;
    }
}

describe("TuiApplication — mouse routing", () => {
    it("dispatches a mouse press and focuses the clicked focusable element", () => {
        const backend = new MockTerminalBackend(new Size(20, 1));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const leaf = new FocusableLeaf();
        body.setContent(leaf);
        app.root = body;
        app.run();

        expect(leaf.isFocused).toBe(false);

        // Click within the leaf's area (row 0). Mouse coords are 1-based.
        backend.simulateMouse(pressMouse(1, 1));

        expect(leaf.isFocused).toBe(true);
    });
});

describe("TuiApplication — resize", () => {
    it("marks the root dirty and re-lays-out on resize", () => {
        const backend = new MockTerminalBackend(new Size(10, 3));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const input = new InputElement();
        body.setContent(input);
        app.root = body;
        app.run();

        backend.resize(new Size(30, 5));

        expect(app.screen.width).toBe(30);
        expect(app.screen.height).toBe(5);
        // Root re-laid-out to the new screen size.
        expect(body.layoutSize.width).toBe(30);
        expect(body.layoutSize.height).toBe(5);
    });
});

describe("TuiApplication — render guard", () => {
    it("does not render when root is null", () => {
        const backend = new MockTerminalBackend(new Size(10, 3));
        const renderSpy = vi.spyOn(backend, "renderFrame");
        const app = new TuiApplication(backend);

        // No root set.
        app.run();

        // renderFrame() returns early because root is null → backend never drawn.
        expect(renderSpy).not.toHaveBeenCalled();
    });
});

describe("TuiApplication — input handlers with no root", () => {
    // After run() registers the backend callbacks, clearing the root must make
    // handleInput/handleMouse/handleResize no-op (the `if (this.root)` false side).
    function runningApp(): { backend: MockTerminalBackend; app: TuiApplication } {
        const backend = new MockTerminalBackend(new Size(20, 3));
        const app = new TuiApplication(backend);
        const body = new BodyElement();
        body.setContent(new InputElement());
        app.root = body;
        app.run();
        app.root = null;
        return { backend, app };
    }

    it("ignores key input when root is null", () => {
        const { backend } = runningApp();
        expect(() => {
            backend.sendKey("a");
        }).not.toThrow();
    });

    it("ignores mouse input when root is null", () => {
        const { backend } = runningApp();
        expect(() => {
            backend.simulateMouse(pressMouse(1, 1));
        }).not.toThrow();
    });

    it("ignores paste when root is null", () => {
        const { backend } = runningApp();
        expect(() => {
            backend.sendPaste("x");
        }).not.toThrow();
    });

    it("ignores resize when root is null but still swaps the screen", () => {
        const { backend, app } = runningApp();
        backend.resize(new Size(30, 5));
        // Screen is recreated even though there is no root to re-lay-out.
        expect(app.screen.width).toBe(30);
        expect(app.screen.height).toBe(5);
    });
});

describe("TuiApplication — Tab cycling direction", () => {
    it("cycles focus backward on Shift+Tab when not prevented", () => {
        const backend = new MockTerminalBackend(new Size(40, 3));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const container = new TwoInputContainer();
        body.setContent(container);
        app.root = body;
        app.run();

        container.second.focus();
        expect(container.second.isFocused).toBe(true);

        backend.sendKey("Shift+Tab");

        // Shift+Tab → backward direction wraps to the first input.
        expect(container.first.isFocused).toBe(true);
        expect(container.second.isFocused).toBe(false);
    });
});
