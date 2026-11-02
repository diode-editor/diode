import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import { QuickInputComponent } from "./quickInputComponent.ts";
import { QuickInputService } from "./quickInputService.ts";

const LONG_NAME = "very.long.name.that.does.not.fit.into.a.narrow.terminal.window.at.all.toml";

function createService(): { service: QuickInputService; testApp: TestApp } {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(60, 20));
    component.attachHost(body);
    return { service, testApp };
}

function frameText(testApp: TestApp): string {
    testApp.render();
    return testApp.backend.screenToString();
}

describe("QuickInputService.input: a value wider than the field", () => {
    it("the character typed over the selected stem of a long name stays in the frame", () => {
        const { service, testApp } = createService();
        void service.input({ title: "Rename", value: LONG_NAME, valueSelection: [0, LONG_NAME.length - 5] });
        testApp.render();

        testApp.sendKey("x");

        expect(frameText(testApp)).toContain("│ x.toml");
    });

    it("the character typed over a whole long seed stays in the frame", () => {
        const { service, testApp } = createService();
        void service.input({ title: "Rename", value: LONG_NAME });
        testApp.render();

        testApp.sendKey("x");

        expect(frameText(testApp)).toContain("│ x ");
    });

    it("a short seed in the next prompt starts from its first character", async () => {
        const { service, testApp } = createService();
        const first = service.input({ title: "Rename", value: LONG_NAME, valueSelection: [0, LONG_NAME.length - 5] });
        testApp.render();
        testApp.sendKey("x");
        testApp.render();
        testApp.sendKey("Escape");
        await first;

        void service.input({ title: "Rename Symbol", value: '"plain"' });

        expect(frameText(testApp)).toContain('│ "plain"');
    });
});
