import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../../src/TestUtils/expectScreen.ts";
import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { RenderContext } from "../../dom/tuiElement.ts";
import { TerminalScreen } from "../../rendering/terminalScreen.ts";

import { BoxElement } from "./boxElement.ts";
import { VStackElement } from "./vStackElement.ts";

function createVStack(
    width: number,
    height: number,
): { vstack: VStackElement; backend: MockTerminalBackend; termScreen: TerminalScreen } {
    const size = new Size(width, height);
    const backend = new MockTerminalBackend(size);
    const termScreen = new TerminalScreen(size);
    const vstack = new VStackElement();
    return { vstack, backend, termScreen };
}

function renderVStack(
    vstack: VStackElement,
    termScreen: TerminalScreen,
    backend: MockTerminalBackend,
): MockTerminalBackend {
    vstack.performLayout(BoxConstraints.tight(termScreen.size));
    vstack.render(new RenderContext(termScreen));
    termScreen.flush(backend);
    return backend;
}

describe("VStackElement", () => {
    it("renders two boxes stacked vertically", () => {
        const { vstack, backend, termScreen } = createVStack(10, 6);

        const box1 = new BoxElement();
        const box2 = new BoxElement();
        vstack.addChild(box1, { width: "fill", height: 3 });
        vstack.addChild(box2, { width: "fill", height: 3 });

        renderVStack(vstack, termScreen, backend);

        expectScreen(
            backend,
            screen`
                +--------+
                |        |
                +--------+
                +--------+
                |        |
                +--------+
            `,
        );
    });

    it("renders three boxes of different heights", () => {
        const { vstack, backend, termScreen } = createVStack(8, 7);

        const box1 = new BoxElement();
        const box2 = new BoxElement();
        const box3 = new BoxElement();
        vstack.addChild(box1, { width: "fill", height: 2 });
        vstack.addChild(box2, { width: "fill", height: 3 });
        vstack.addChild(box3, { width: "fill", height: 2 });

        renderVStack(vstack, termScreen, backend);

        expectScreen(
            backend,
            screen`
                +------+
                +------+
                +------+
                |      |
                +------+
                +------+
                +------+
            `,
        );
    });

    it("renders a child with width smaller than container", () => {
        const { vstack, backend, termScreen } = createVStack(8, 4);

        const narrowBox = new BoxElement();
        const wideBox = new BoxElement();
        vstack.addChild(narrowBox, { width: 4, height: 2 });
        vstack.addChild(wideBox, { width: "fill", height: 2 });

        renderVStack(vstack, termScreen, backend);

        expectScreen(
            backend,
            screen`
                +--+
                +--+
                +------+
                +------+
            `,
        );
    });

    it("renders a single child", () => {
        const { vstack, backend, termScreen } = createVStack(6, 3);

        const box = new BoxElement();
        vstack.addChild(box, { width: "fill", height: 3 });

        renderVStack(vstack, termScreen, backend);

        expectScreen(
            backend,
            screen`
                +----+
                |    |
                +----+
            `,
        );
    });

    it("renders nested VStacks", () => {
        const { vstack: outer, backend, termScreen } = createVStack(10, 6);

        const inner = new VStackElement();
        const box1 = new BoxElement();
        const box2 = new BoxElement();
        inner.addChild(box1, { width: "fill", height: 2 });
        inner.addChild(box2, { width: "fill", height: 2 });

        const bottomBox = new BoxElement();
        outer.addChild(inner, { width: "fill", height: 4 });
        outer.addChild(bottomBox, { width: "fill", height: 2 });

        renderVStack(outer, termScreen, backend);

        expectScreen(
            backend,
            screen`
                +--------+
                +--------+
                +--------+
                +--------+
                +--------+
                +--------+
            `,
        );
    });

    it("renders boxes that do not fill container height", () => {
        const { vstack, backend, termScreen } = createVStack(6, 5);

        const box = new BoxElement();
        vstack.addChild(box, { width: "fill", height: 2 });

        renderVStack(vstack, termScreen, backend);

        expectScreen(
            backend,
            screen`
                +----+
                +----+
            `,
        );
    });

    it("children default to container width when width is fill", () => {
        const { vstack, backend, termScreen } = createVStack(10, 3);

        const box = new BoxElement();
        vstack.addChild(box, { width: "fill", height: 3 });

        renderVStack(vstack, termScreen, backend);

        expectScreen(
            backend,
            screen`
                +--------+
                |        |
                +--------+
            `,
        );
    });

    it("renders multiple children with explicit widths", () => {
        const { vstack, backend, termScreen } = createVStack(10, 4);

        const box1 = new BoxElement();
        const box2 = new BoxElement();
        vstack.addChild(box1, { width: 6, height: 2 });
        vstack.addChild(box2, { width: 10, height: 2 });

        renderVStack(vstack, termScreen, backend);

        expectScreen(
            backend,
            screen`
                +----+
                +----+
                +--------+
                +--------+
            `,
        );
    });

    it("sets localPosition for each child", () => {
        const { vstack } = createVStack(10, 6);

        const box1 = new BoxElement();
        const box2 = new BoxElement();
        vstack.addChild(box1, { width: "fill", height: 3 });
        vstack.addChild(box2, { width: "fill", height: 3 });

        vstack.performLayout(BoxConstraints.tight(new Size(10, 6)));

        // First child at y=0
        expect(box1.localPosition).toEqual(new Offset(0, 0));
        // Second child at y=3
        expect(box2.localPosition).toEqual(new Offset(0, 3));
    });

    it("sets globalPosition for each child based on parent globalPosition", () => {
        const { vstack } = createVStack(10, 6);

        const box1 = new BoxElement();
        const box2 = new BoxElement();
        vstack.addChild(box1, { width: "fill", height: 3 });
        vstack.addChild(box2, { width: "fill", height: 3 });

        // Set parent global position to (5, 10)
        vstack.localPosition = new Offset(5, 10);
        vstack.performLayout(BoxConstraints.tight(new Size(10, 6)));

        // First child should be at (5, 10)
        expect(box1.globalPosition).toEqual(new Point(5, 10));
        // Second child should be at (5, 13)
        expect(box2.globalPosition).toEqual(new Point(5, 13));
    });

    it("child markDirty propagates to parent", () => {
        const { vstack } = createVStack(10, 6);

        const box = new BoxElement();
        vstack.addChild(box, { width: "fill", height: 3 });

        vstack.performLayout(BoxConstraints.tight(new Size(10, 6)));
        expect(vstack.isLayoutDirty).toBe(false);

        box.markDirty();

        expect(vstack.isLayoutDirty).toBe(true);
    });

    it("child inherits vstack as parent after addChild", () => {
        const { vstack } = createVStack(10, 6);
        const box = new BoxElement();

        vstack.addChild(box, { width: "fill", height: 3 });

        // Verify by checking that child's markDirty affects vstack
        vstack.performLayout(BoxConstraints.tight(new Size(10, 6)));
        box.markDirty();

        expect(vstack.isLayoutDirty).toBe(true);
    });

    describe("replaceChildren", () => {
        it("unparents children that are removed and parents the new ones", () => {
            const { vstack } = createVStack(10, 6);
            const removed = new BoxElement();
            const kept = new BoxElement();
            removed.layoutStyle = { width: "fill", height: 3 };
            kept.layoutStyle = { width: "fill", height: 3 };
            vstack.addChild(removed, { width: "fill", height: 3 });
            vstack.addChild(kept, { width: "fill", height: 3 });

            const added = new BoxElement();
            added.layoutStyle = { width: "fill", height: 3 };

            // `kept` stays, `removed` drops out, `added` is new.
            vstack.replaceChildren([kept, added]);

            expect(removed.getParent()).toBeNull();
            expect(kept.getParent()).toBe(vstack);
            expect(added.getParent()).toBe(vstack);
            expect(vstack.getChildren()).toEqual([kept, added]);
        });

        it("renders the replacement children in order", () => {
            const { vstack, backend, termScreen } = createVStack(8, 4);
            const original = new BoxElement();
            original.layoutStyle = { width: "fill", height: 4 };
            vstack.addChild(original, { width: "fill", height: 4 });

            const top = new BoxElement();
            const bottom = new BoxElement();
            top.layoutStyle = { width: "fill", height: 2 };
            bottom.layoutStyle = { width: "fill", height: 2 };
            vstack.replaceChildren([top, bottom]);

            renderVStack(vstack, termScreen, backend);

            expectScreen(
                backend,
                screen`
                    +------+
                    +------+
                    +------+
                    +------+
                `,
            );
        });
    });
});
