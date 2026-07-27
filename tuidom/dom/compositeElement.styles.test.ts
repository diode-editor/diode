import { describe, expect, it } from "vitest";

import { packRgb } from "../common/colorUtils.ts";
import { TextLabel } from "../ui/text/textLabelElement.ts";

import { CompositeElement } from "./compositeElement.ts";
import type { JsxNode } from "./jsx/jsx-runtime.ts";
import { ROOT_RESOLVED_STYLE } from "./styles/tuiStyle.ts";
import { TUIElement } from "./tuiElement.ts";

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

class TestComposite extends CompositeElement {
    public color = packRgb(100, 100, 100);

    public constructor() {
        super();
        this.rebuild();
    }

    public describe(): JsxNode {
        return TextLabel({ text: "test", fg: this.color, bg: this.color });
    }
}

describe("CompositeElement style resolution", () => {
    it("rebuild with new colors resolves correctly after style resolution", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const composite = new TestComposite();
        root.addChild(composite);

        root.performStyleResolution(ROOT_RESOLVED_STYLE);
        expect(composite.getRootChild()!.resolvedStyle.fg).toBe(packRgb(100, 100, 100));

        composite.color = packRgb(255, 0, 0);
        composite.rebuild();
        root.performStyleResolution(ROOT_RESOLVED_STYLE);
        expect(composite.getRootChild()!.resolvedStyle.fg).toBe(packRgb(255, 0, 0));
    });

    it("newly attached composite resolves child styles", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        root.performStyleResolution(ROOT_RESOLVED_STYLE);

        const composite = new TestComposite();
        composite.color = packRgb(0, 90, 180);
        composite.rebuild();

        root.addChild(composite);
        root.performStyleResolution(ROOT_RESOLVED_STYLE);
        const child = composite.getRootChild()!;
        expect(child.resolvedStyle.fg).toBe(packRgb(0, 90, 180));
    });
});
