import { describe, expect, it, vi } from "vitest";

import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import type { MouseToken } from "../../input/rawTerminalToken.ts";
import { BodyElement } from "../../ui/body/bodyElement.ts";
import { TuiApplication } from "../tuiApplication.ts";
import { TUIElement } from "../tuiElement.ts";

import type { TUIMouseEvent } from "./tuiMouseEvent.ts";

// ─── Helpers ───

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }

    public override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        for (const child of this.getChildren()) {
            child.layout(BoxConstraints.tight(child.layoutSize));
        }
        return size;
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

// ─── Tests ───

describe("MouseEventDispatcher integration with TuiApplication", () => {
    it("delivers click event to element via simulateMouse", () => {
        const backend = new MockTerminalBackend(new Size(80, 24));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const root = new ContainerElement();
        const child = new TUIElement();
        child.localPosition = new Offset(10, 5);
        child.layout(BoxConstraints.tight(new Size(20, 10)));
        root.addChild(child);

        body.setContent(root);
        app.root = body;
        app.run();

        const clicks: TUIMouseEvent[] = [];
        child.addEventListener("click", (e) => {
            clicks.push(e);
        });

        // 1-based coords: (16, 9) → 0-based (15, 8), inside child at (10,5)+(20,10)
        backend.simulateMouse(makeToken({ action: "press", x: 16, y: 9 }));
        backend.simulateMouse(makeToken({ action: "release", x: 16, y: 9 }));

        expect(clicks).toHaveLength(1);
        expect(clicks[0].screenX).toBe(15);
        expect(clicks[0].screenY).toBe(8);
    });

    it("delivers mouseenter when mouse moves onto element", () => {
        const backend = new MockTerminalBackend(new Size(80, 24));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const root = new ContainerElement();
        const child = new TUIElement();
        child.localPosition = new Offset(10, 5);
        child.layout(BoxConstraints.tight(new Size(20, 10)));
        root.addChild(child);

        body.setContent(root);
        app.root = body;
        app.run();

        const enters: TUIMouseEvent[] = [];
        child.addEventListener("mouseenter", (e) => {
            enters.push(e);
        });

        backend.simulateMouse(makeToken({ action: "move", x: 16, y: 9 }));

        expect(enters).toHaveLength(1);
    });

    it("wheel event reaches element via backend", () => {
        const backend = new MockTerminalBackend(new Size(80, 24));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const root = new TUIElement();
        body.setContent(root);
        app.root = body;
        app.run();

        const wheels: TUIMouseEvent[] = [];
        root.addEventListener("wheel", (e) => {
            wheels.push(e);
        });

        backend.simulateMouse(makeToken({ action: "scroll-down", x: 1, y: 1 }));

        expect(wheels).toHaveLength(1);
        expect(wheels[0].wheelDirection).toBe("down");
    });
});
