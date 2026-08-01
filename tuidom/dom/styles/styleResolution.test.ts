import { describe, expect, it } from "vitest";

import { packRgb } from "../../common/colorUtils.ts";
import { TUIElement } from "../tuiElement.ts";

import { ROOT_RESOLVED_STYLE } from "./tuiStyle.ts";

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

describe("style setter triggers dirty", () => {
    it("marks self and all descendants dirty", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const mid = new ContainerElement();
        const leaf = new TUIElement();
        root.addChild(mid);
        mid.addChild(leaf);

        root.performStyleResolution(ROOT_RESOLVED_STYLE);

        const fg = packRgb(100, 200, 50);
        root.style = { fg };
        root.performStyleResolution(ROOT_RESOLVED_STYLE);

        expect(root.resolvedStyle.fg).toBe(fg);
        expect(mid.resolvedStyle.fg).toBe(fg);
        expect(leaf.resolvedStyle.fg).toBe(fg);
    });

    it("triggers markDirty for render scheduling", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        let renderRequested = false;
        root.setRequestRenderCallback(() => {
            renderRequested = true;
        });

        root.style = { fg: packRgb(1, 2, 3) };
        expect(renderRequested).toBe(true);
    });

    it("пуш равного по значению стиля — no-op (не дирявит и не планирует кадр)", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.style = { fg: packRgb(1, 2, 3), bg: packRgb(4, 5, 6) };
        root.performStyleResolution(ROOT_RESOLVED_STYLE);

        let renderRequested = false;
        root.setRequestRenderCallback(() => {
            renderRequested = true;
        });

        root.style = { fg: packRgb(1, 2, 3), bg: packRgb(4, 5, 6) };
        expect(renderRequested).toBe(false);
    });
});

describe("performStyleResolution", () => {
    it("clears dirty flags after resolution", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const child = new TUIElement();
        root.addChild(child);

        root.performStyleResolution(ROOT_RESOLVED_STYLE);

        const fg = packRgb(255, 0, 0);
        root.style = { fg };
        root.performStyleResolution(ROOT_RESOLVED_STYLE);

        expect(root.resolvedStyle.fg).toBe(fg);
    });

    it("cascades fg through tree", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const mid = new ContainerElement();
        const leaf = new TUIElement();
        root.addChild(mid);
        mid.addChild(leaf);

        const green = packRgb(0, 255, 0);
        root.style = { fg: green };

        root.performStyleResolution(ROOT_RESOLVED_STYLE);

        expect(root.resolvedStyle.fg).toBe(green);
        expect(mid.resolvedStyle.fg).toBe(green);
        expect(leaf.resolvedStyle.fg).toBe(green);
    });

    it("mid-level fg override shadows parent", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const mid = new ContainerElement();
        const leaf = new TUIElement();
        root.addChild(mid);
        mid.addChild(leaf);

        const rootFg = packRgb(255, 255, 255);
        const midFg = packRgb(128, 128, 128);
        root.style = { fg: rootFg };
        mid.style = { fg: midFg };

        root.performStyleResolution(ROOT_RESOLVED_STYLE);

        expect(root.resolvedStyle.fg).toBe(rootFg);
        expect(mid.resolvedStyle.fg).toBe(midFg);
        expect(leaf.resolvedStyle.fg).toBe(midFg);
    });

    it("explicit fg on leaf overrides cascade", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const leaf = new TUIElement();
        root.addChild(leaf);

        const rootFg = packRgb(200, 200, 200);
        const leafFg = packRgb(255, 0, 0);
        root.style = { fg: rootFg };
        leaf.style = { fg: leafFg };

        root.performStyleResolution(ROOT_RESOLVED_STYLE);

        expect(root.resolvedStyle.fg).toBe(rootFg);
        expect(leaf.resolvedStyle.fg).toBe(leafFg);
    });

    it("early exit: clean subtree is not re-resolved", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const child = new TUIElement();
        root.addChild(child);

        const fg1 = packRgb(10, 20, 30);
        root.style = { fg: fg1 };

        root.performStyleResolution(ROOT_RESOLVED_STYLE);
        expect(child.resolvedStyle.fg).toBe(fg1);

        root.performStyleResolution(ROOT_RESOLVED_STYLE);
        expect(child.resolvedStyle.fg).toBe(fg1);
    });

    it("cascade change via style setter updates entire subtree", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const mid = new ContainerElement();
        const leaf = new TUIElement();
        root.addChild(mid);
        mid.addChild(leaf);

        const fg1 = packRgb(100, 100, 100);
        root.style = { fg: fg1 };
        root.performStyleResolution(ROOT_RESOLVED_STYLE);
        expect(leaf.resolvedStyle.fg).toBe(fg1);

        const fg2 = packRgb(200, 200, 200);
        root.style = { fg: fg2 };
        root.performStyleResolution(ROOT_RESOLVED_STYLE);

        expect(root.resolvedStyle.fg).toBe(fg2);
        expect(mid.resolvedStyle.fg).toBe(fg2);
        expect(leaf.resolvedStyle.fg).toBe(fg2);
    });

    it("child style change resolves when parent is clean", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const mid = new ContainerElement();
        const leaf = new TUIElement();
        root.addChild(mid);
        mid.addChild(leaf);

        root.performStyleResolution(ROOT_RESOLVED_STYLE);

        const leafFg = packRgb(255, 0, 128);
        leaf.style = { fg: leafFg };
        root.performStyleResolution(ROOT_RESOLVED_STYLE);

        expect(leaf.resolvedStyle.fg).toBe(leafFg);
    });

    it("deeply nested child style change propagates through clean ancestors", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const a = new ContainerElement();
        const b = new ContainerElement();
        const c = new TUIElement();
        root.addChild(a);
        a.addChild(b);
        b.addChild(c);

        root.performStyleResolution(ROOT_RESOLVED_STYLE);

        const bg = packRgb(0, 90, 180);
        c.style = { bg };
        root.performStyleResolution(ROOT_RESOLVED_STYLE);

        expect(c.resolvedStyle.bg).toBe(bg);
        expect(a.resolvedStyle.bg).toBe(ROOT_RESOLVED_STYLE.bg);
        expect(b.resolvedStyle.bg).toBe(ROOT_RESOLVED_STYLE.bg);
    });

    it("newly attached subtree with dirty styles resolves correctly", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const mid = new ContainerElement();
        root.addChild(mid);
        root.performStyleResolution(ROOT_RESOLVED_STYLE);

        const detached = new ContainerElement();
        const leaf = new TUIElement();
        detached.addChild(leaf);
        const fg = packRgb(0, 128, 255);
        leaf.style = { fg };

        mid.addChild(detached);
        root.performStyleResolution(ROOT_RESOLVED_STYLE);
        expect(leaf.resolvedStyle.fg).toBe(fg);
    });

    it("newly created element attached to clean parent resolves styles", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        root.performStyleResolution(ROOT_RESOLVED_STYLE);

        const child = new TUIElement();
        child.style = { bg: packRgb(0, 90, 180) };
        root.addChild(child);
        root.performStyleResolution(ROOT_RESOLVED_STYLE);
        expect(child.resolvedStyle.bg).toBe(packRgb(0, 90, 180));
    });
});
