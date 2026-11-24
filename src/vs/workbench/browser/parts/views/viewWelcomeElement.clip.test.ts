import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { assertValidTree } from "@tuidom/core/dom/validateTree";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { describe, expect, it } from "vitest";

import type { IViewWelcomeBlock } from "./viewWelcomeElement.ts";
import { ViewWelcomeElement } from "./viewWelcomeElement.ts";

const WELCOME: readonly IViewWelcomeBlock[] = [
    { kind: "text", text: "You have not yet opened a folder." },
    { kind: "button", label: "Open Folder", command: "workbench.action.files.openFolder" },
    { kind: "button", label: "Clone Repository", command: "git.clone" },
];

function laidOut(height: number): ViewWelcomeElement {
    const welcome = new ViewWelcomeElement(WELCOME, () => undefined);
    welcome.setAsRoot();
    welcome.layout(BoxConstraints.tight(new Size(40, height)));
    return welcome;
}

describe("ViewWelcomeElement in a section shorter than its welcome", () => {
    it("clips the trailing buttons to its height, keeping them inside it", () => {
        const welcome = laidOut(2);
        const buttons = welcome.getChildren().filter((child): child is ButtonElement => child instanceof ButtonElement);

        expect(() => {
            assertValidTree(welcome);
        }).not.toThrow();
        for (const button of buttons) {
            expect(button.localPosition.dy + button.layoutSize.height).toBeLessThanOrEqual(2);
        }
        // The last button lies past the bottom: no rows, so no clicks land on it.
        expect(buttons.at(-1)?.layoutSize.height).toBe(0);
    });

    it("lays the buttons out whole when the section has room", () => {
        const welcome = laidOut(10);
        const buttons = welcome.getChildren().filter((child): child is ButtonElement => child instanceof ButtonElement);

        expect(buttons.map((button) => button.layoutSize.height)).toEqual([1, 1]);
    });
});
