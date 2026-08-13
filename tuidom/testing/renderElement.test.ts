import { describe, expect, it } from "vitest";

import { packRgb } from "../common/colorUtils.ts";
import { BoxConstraints, Point, Size } from "../common/geometryPromitives.ts";
import { BoxElement } from "../ui/layout/boxElement.ts";
import { TextLabelElement } from "../ui/text/textLabelElement.ts";

import { DARK_PLUS_STYLE_VARS } from "./darkPlusStyleVars.ts";
import { expectScreen, screen } from "./expectScreen.ts";
import { renderElement } from "./renderElement.ts";

describe("renderElement", () => {
    it("рендерит элемент tight-constraints по размеру бэкенда (дефолт)", () => {
        const backend = renderElement(new BoxElement(), 6, 3);
        expectScreen(
            backend,
            screen`
                +----+
                |    |
                +----+
            `,
        );
    });

    it("уважает кастомные constraints, отличные от размера бэкенда", () => {
        const backend = renderElement(new BoxElement(), 8, 3, {
            constraints: BoxConstraints.tight(new Size(4, 3)),
        });
        expectScreen(
            backend,
            screen`
                +--+
                |  |
                +--+
            `,
        );
    });

    it("resolveStyles прогоняет style resolution перед рендером", () => {
        const label = new TextLabelElement("hi");
        const backend = renderElement(label, 5, 1, { resolveStyles: true });
        expect(backend.getTextAt(new Point(0, 0), 2)).toBe("hi");
    });

    it("styleVars кладёт явную палитру в var-scope элемента (включая резолв)", () => {
        const box = new BoxElement();
        box.style = { bg: "custom.token" };
        renderElement(box, 4, 3, { styleVars: { "custom.token": packRgb(9, 9, 9) } });
        expect(box.resolvedStyle.bg).toBe(packRgb(9, 9, 9));
    });

    it("themeVars кладёт снапшот Dark+", () => {
        const box = new BoxElement();
        box.style = { bg: "editor.background" };
        renderElement(box, 4, 3, { themeVars: true });
        expect(box.resolvedStyle.bg).toBe(DARK_PLUS_STYLE_VARS["editor.background"]);
    });
});
