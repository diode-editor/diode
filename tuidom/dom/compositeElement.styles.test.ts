import { describe, expect, it } from "vitest";

import { packRgb } from "../common/colorUtils.ts";
import { TextLabelElement } from "../ui/text/textLabelElement.ts";

import { CompositeElement } from "./compositeElement.ts";
import { ROOT_STYLE_CONTEXT } from "./styles/tuiStyle.ts";
import { TUIElement } from "./tuiElement.ts";

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

class TestComposite extends CompositeElement {
    public constructor(color: number) {
        super();
        this.recolor(color);
    }

    public recolor(color: number): void {
        const label = new TextLabelElement("test");
        label.setColors(color, color);
        this.setRootChild(label);
    }
}

describe("CompositeElement style resolution", () => {
    it("replacing the root child with new colors resolves correctly after style resolution", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const composite = new TestComposite(packRgb(100, 100, 100));
        root.addChild(composite);

        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(composite.getRootChild()!.resolvedStyle.fg).toBe(packRgb(100, 100, 100));

        composite.recolor(packRgb(255, 0, 0));
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(composite.getRootChild()!.resolvedStyle.fg).toBe(packRgb(255, 0, 0));
    });

    it("newly attached composite resolves child styles", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        const composite = new TestComposite(packRgb(0, 90, 180));

        root.addChild(composite);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        const child = composite.getRootChild()!;
        expect(child.resolvedStyle.fg).toBe(packRgb(0, 90, 180));
    });
});
