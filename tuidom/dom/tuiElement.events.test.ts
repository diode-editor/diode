import { describe, expect, it, vi } from "vitest";

import { EventPhase, TUIEventBase } from "./events/tuiEventBase.ts";
import { TUIKeyboardEvent } from "./events/tuiKeyboardEvent.ts";
import { TUIElement } from "./tuiElement.ts";

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

function buildTree(): { root: ContainerElement; parent: ContainerElement; child: TUIElement } {
    const root = new ContainerElement();
    root.setAsRoot();
    const parent = new ContainerElement();
    root.addChild(parent);
    const child = new TUIElement();
    parent.addChild(child);
    return { root, parent, child };
}

describe("TUIElement event system", () => {
    it("calls keypress listeners on keypress event", () => {
        const element = new TUIElement();
        const handler = vi.fn<(event: TUIKeyboardEvent) => void>();
        element.addEventListener("keypress", handler);

        const event = new TUIKeyboardEvent("keypress", { key: "a", code: "KeyA" });
        element.dispatchEvent(event);

        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0].key).toBe("a");
        expect(handler.mock.calls[0][0].type).toBe("keypress");
    });

    it("calls keydown listeners on keydown event", () => {
        const element = new TUIElement();
        const handler = vi.fn<(event: TUIKeyboardEvent) => void>();
        element.addEventListener("keydown", handler);

        const event = new TUIKeyboardEvent("keydown", { key: "a", code: "KeyA" });
        element.dispatchEvent(event);

        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0].key).toBe("a");
        expect(handler.mock.calls[0][0].type).toBe("keydown");
    });

    it("calls keyup listeners on keyup event", () => {
        const element = new TUIElement();
        const handler = vi.fn<(event: TUIKeyboardEvent) => void>();
        element.addEventListener("keyup", handler);

        const event = new TUIKeyboardEvent("keyup", { key: "a", code: "KeyA" });
        element.dispatchEvent(event);

        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0].key).toBe("a");
        expect(handler.mock.calls[0][0].type).toBe("keyup");
    });

    it("does not call keypress listeners on keydown event", () => {
        const element = new TUIElement();
        const keypressHandler = vi.fn();
        element.addEventListener("keypress", keypressHandler);

        element.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));

        expect(keypressHandler).not.toHaveBeenCalled();
    });

    it("does not crash when emitting event with no listeners", () => {
        const element = new TUIElement();
        expect(() => {
            element.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "a" }));
            element.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));
            element.dispatchEvent(new TUIKeyboardEvent("keyup", { key: "a" }));
        }).not.toThrow();
    });

    it("supports multiple listeners for the same event type", () => {
        const element = new TUIElement();
        const handler1 = vi.fn();
        const handler2 = vi.fn();
        element.addEventListener("keydown", handler1);
        element.addEventListener("keydown", handler2);

        element.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));

        expect(handler1).toHaveBeenCalledOnce();
        expect(handler2).toHaveBeenCalledOnce();
    });

    it("removes a specific listener with removeEventListener", () => {
        const element = new TUIElement();
        const handler = vi.fn();
        element.addEventListener("keydown", handler);
        element.removeEventListener("keydown", handler);

        element.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));

        expect(handler).not.toHaveBeenCalled();
    });

    it("removeEventListener does not affect other listeners", () => {
        const element = new TUIElement();
        const handler1 = vi.fn();
        const handler2 = vi.fn();
        element.addEventListener("keypress", handler1);
        element.addEventListener("keypress", handler2);

        element.removeEventListener("keypress", handler1);
        element.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "a" }));

        expect(handler1).not.toHaveBeenCalled();
        expect(handler2).toHaveBeenCalledOnce();
    });

    it("removeEventListener is no-op for unregistered handler", () => {
        const element = new TUIElement();
        const handler = vi.fn();

        expect(() => {
            element.removeEventListener("keyup", handler);
        }).not.toThrow();
    });
});

describe("TUIElement.addEventListener (new event system)", () => {
    it("registers and fires bubble listener", () => {
        const el = new TUIElement();
        const handler = vi.fn();
        el.addEventListener("keydown", handler);

        const event = new TUIKeyboardEvent("keydown", { key: "a" });
        el.dispatchEvent(event);

        expect(handler).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith(event);
    });

    it("registers and fires capture listener", () => {
        const el = new TUIElement();
        const handler = vi.fn();
        el.addEventListener("keydown", handler, { capture: true });

        const event = new TUIKeyboardEvent("keydown", { key: "a" });
        el.dispatchEvent(event);

        expect(handler).toHaveBeenCalledOnce();
    });

    it("removeEventListener removes specific listener", () => {
        const el = new TUIElement();
        const handler = vi.fn();
        el.addEventListener("keydown", handler);
        el.removeEventListener("keydown", handler);

        el.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));
        expect(handler).not.toHaveBeenCalled();
    });

    it("removeEventListener distinguishes capture vs bubble", () => {
        const el = new TUIElement();
        const handler = vi.fn();
        el.addEventListener("keydown", handler, { capture: true });
        // Removing bubble version should NOT remove capture version
        el.removeEventListener("keydown", handler, { capture: false });

        el.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));
        expect(handler).toHaveBeenCalledOnce();
    });
});

describe("TUIElement.dispatchEvent — propagation phases", () => {
    it("dispatches in capture → target → bubble order", () => {
        const { root, parent, child } = buildTree();
        const log: string[] = [];

        root.addEventListener("keydown", () => log.push("root-capture"), { capture: true });
        root.addEventListener("keydown", () => log.push("root-bubble"));
        parent.addEventListener("keydown", () => log.push("parent-capture"), { capture: true });
        parent.addEventListener("keydown", () => log.push("parent-bubble"));
        child.addEventListener("keydown", () => log.push("child-target"));

        child.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));

        expect(log).toEqual(["root-capture", "parent-capture", "child-target", "parent-bubble", "root-bubble"]);
    });

    it("sets target and currentTarget correctly", () => {
        const { root, child } = buildTree();
        const targets: { target: TUIElement | null; currentTarget: TUIElement | null }[] = [];

        root.addEventListener(
            "keydown",
            (e) => {
                targets.push({ target: e.target, currentTarget: e.currentTarget });
            },
            { capture: true },
        );
        child.addEventListener("keydown", (e) => {
            targets.push({ target: e.target, currentTarget: e.currentTarget });
        });

        child.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));

        expect(targets[0].target).toBe(child);
        expect(targets[0].currentTarget).toBe(root);
        expect(targets[1].target).toBe(child);
        expect(targets[1].currentTarget).toBe(child);
    });

    it("sets eventPhase correctly during dispatch", () => {
        const { root, parent, child } = buildTree();
        const phases: number[] = [];

        root.addEventListener("keydown", (e) => phases.push(e.eventPhase), { capture: true });
        parent.addEventListener("keydown", (e) => phases.push(e.eventPhase), { capture: true });
        child.addEventListener("keydown", (e) => phases.push(e.eventPhase));
        parent.addEventListener("keydown", (e) => phases.push(e.eventPhase));
        root.addEventListener("keydown", (e) => phases.push(e.eventPhase));

        child.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));

        expect(phases).toEqual([
            EventPhase.CAPTURING,
            EventPhase.CAPTURING,
            EventPhase.AT_TARGET,
            EventPhase.BUBBLING,
            EventPhase.BUBBLING,
        ]);
    });

    it("stopPropagation during capture prevents target and bubble", () => {
        const { root, parent, child } = buildTree();
        const log: string[] = [];

        root.addEventListener(
            "keydown",
            (e) => {
                log.push("root-capture");
                e.stopPropagation();
            },
            { capture: true },
        );
        parent.addEventListener("keydown", () => log.push("parent-capture"), { capture: true });
        child.addEventListener("keydown", () => log.push("child-target"));
        root.addEventListener("keydown", () => log.push("root-bubble"));

        child.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));

        expect(log).toEqual(["root-capture"]);
    });

    it("stopPropagation during bubble prevents further bubbling", () => {
        const { root, parent, child } = buildTree();
        const log: string[] = [];

        child.addEventListener("keydown", () => log.push("child-target"));
        parent.addEventListener("keydown", (e) => {
            log.push("parent-bubble");
            e.stopPropagation();
        });
        root.addEventListener("keydown", () => log.push("root-bubble"));

        child.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));

        expect(log).toEqual(["child-target", "parent-bubble"]);
    });

    it("stopImmediatePropagation prevents other listeners on same element", () => {
        const el = new TUIElement();
        const log: string[] = [];

        el.addEventListener("keydown", (e) => {
            log.push("first");
            e.stopImmediatePropagation();
        });
        el.addEventListener("keydown", () => log.push("second"));

        el.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));

        expect(log).toEqual(["first"]);
    });

    it("non-bubbling event does not bubble", () => {
        const { root, child } = buildTree();
        const log: string[] = [];

        root.addEventListener("keydown", () => log.push("root-capture"), { capture: true });
        child.addEventListener("keydown", () => log.push("child-target"));
        root.addEventListener("keydown", () => log.push("root-bubble"));

        // Create a non-bubbling event
        const event = new TUIEventBase("keydown", false);
        child.dispatchEvent(event);

        expect(log).toEqual(["root-capture", "child-target"]);
    });

    it("returns true when preventDefault not called", () => {
        const el = new TUIElement();
        const result = el.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));
        expect(result).toBe(true);
    });

    it("returns false when preventDefault called", () => {
        const el = new TUIElement();
        el.addEventListener("keydown", (e) => {
            e.preventDefault();
        });
        const result = el.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));
        expect(result).toBe(false);
    });

    it("at target phase fires both capture and bubble listeners", () => {
        const el = new TUIElement();
        const log: string[] = [];

        el.addEventListener("keydown", () => log.push("capture"), { capture: true });
        el.addEventListener("keydown", () => log.push("bubble"));

        el.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));

        expect(log).toEqual(["capture", "bubble"]);
    });

    it("resets eventPhase to NONE after dispatch", () => {
        const el = new TUIElement();
        const event = new TUIKeyboardEvent("keydown", { key: "a" });
        el.dispatchEvent(event);
        expect(event.eventPhase).toBe(EventPhase.NONE);
        expect(event.currentTarget).toBeNull();
    });
});
