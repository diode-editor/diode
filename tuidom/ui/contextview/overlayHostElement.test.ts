import { describe, expect, it } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import { BoxElement } from "../layout/boxElement.ts";

import { OverlayHostElement } from "./overlayHostElement.ts";

const CONTENT_BG = packRgb(10, 20, 30);
const OVERLAY_BG = packRgb(200, 100, 50);

/** Solid-colour element. Fills its allotted size, or a fixed size if given. */
class FillElement extends TUIElement {
    private readonly color: number;
    private readonly fixed?: Size;

    public constructor(color: number, fixed?: Size) {
        super();
        this.color = color;
        this.fixed = fixed;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        return super.performLayout(this.fixed ? BoxConstraints.tight(this.fixed) : constraints);
    }

    public override render(context: RenderContext): void {
        const { width, height } = this.layoutSize;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                context.setCell(x, y, { char: " ", bg: this.color });
            }
        }
    }
}

function createHost(width = 20, height = 5): { app: TestApp; host: OverlayHostElement; content: FillElement } {
    const host = new OverlayHostElement();
    const content = new FillElement(CONTENT_BG);
    host.setContent(content);
    const app = TestApp.createWithContent(host, new Size(width, height));
    return { app, host, content };
}

describe("OverlayHostElement", () => {
    describe("layout", () => {
        it("lays the content out tight to the host size", () => {
            const host = new OverlayHostElement();
            const content = new BoxElement();
            host.setContent(content);
            host.localPosition = new Offset(0, 0);
            host.layout(BoxConstraints.tight(new Size(40, 10)));

            expect(content.localPosition).toEqual(new Offset(0, 0));
            expect(content.layoutSize).toEqual(new Size(40, 10));
        });

        it("works without content", () => {
            const host = new OverlayHostElement();
            host.localPosition = new Offset(0, 0);
            host.layout(BoxConstraints.tight(new Size(40, 10)));

            expect(host.overlayLayer.layoutSize).toEqual(new Size(40, 10));
        });
    });

    describe("children", () => {
        it("holds only the overlay layer when no content", () => {
            const host = new OverlayHostElement();
            expect(host.getChildren()).toEqual([host.overlayLayer]);
        });

        it("keeps the overlay layer last so it sits on top", () => {
            const host = new OverlayHostElement();
            const content = new BoxElement();
            host.setContent(content);
            expect(host.getChildren()).toEqual([content, host.overlayLayer]);
        });
    });

    describe("setContent", () => {
        it("replaces content element", () => {
            const host = new OverlayHostElement();
            const content1 = new BoxElement();
            const content2 = new BoxElement();

            host.setContent(content1);
            expect(host.getContent()).toBe(content1);

            host.setContent(content2);
            expect(host.getContent()).toBe(content2);
        });

        it("unparents old content", () => {
            const host = new OverlayHostElement();
            const content1 = new BoxElement();
            const content2 = new BoxElement();

            host.setContent(content1);
            host.setContent(content2);

            expect(content1.getParent()).toBeNull();
        });

        it("setContent(null) removes content", () => {
            const host = new OverlayHostElement();
            const content = new BoxElement();

            host.setContent(content);
            host.setContent(null);

            expect(host.getContent()).toBeNull();
            expect(host.getChildren()).toEqual([host.overlayLayer]);
        });
    });

    describe("overlay layer", () => {
        it("renders an overlay item on top of the content", () => {
            const { app, host } = createHost();
            host.overlayLayer.addItem(new FillElement(OVERLAY_BG, new Size(5, 1)), new Point(0, 1), true);
            app.render();

            // Inside the item → overlay colour (wins over the content underneath).
            expect(app.backend.getBgAt(new Point(0, 1))).toBe(OVERLAY_BG);
            // Outside the item, same row → content still shows through.
            expect(app.backend.getBgAt(new Point(10, 1))).toBe(CONTENT_BG);
        });

        it("positions overlay items relative to the host", () => {
            const { app, host } = createHost();
            const item = new FillElement(OVERLAY_BG, new Size(3, 1));
            host.overlayLayer.addItem(item, new Point(2, 1), true);
            app.render();

            expect(item.globalPosition).toEqual(new Point(host.globalPosition.x + 2, host.globalPosition.y + 1));
            // The layer spans the whole host, so items are clipped to the host bounds.
            expect(host.overlayLayer.layoutSize).toEqual(host.layoutSize);
        });

        it("does not affect the content layout", () => {
            const { app, host, content } = createHost();
            app.render();
            const sizeBefore = content.layoutSize;
            const posBefore = content.globalPosition;

            host.overlayLayer.addItem(new FillElement(OVERLAY_BG, new Size(5, 1)), new Point(0, 1), true);
            app.render();

            expect(content.layoutSize).toEqual(sizeBefore);
            expect(content.globalPosition).toEqual(posBefore);
        });
    });
});
