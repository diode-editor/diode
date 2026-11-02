import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import { QuickInputComponent } from "./quickInputComponent.ts";
import { QuickInputService } from "./quickInputService.ts";

function createService(): { service: QuickInputService; testApp: TestApp } {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    return { service, testApp };
}

async function typeOver(value: string | undefined, valueSelection?: [number, number], keys = ["x"]): Promise<unknown> {
    const { service, testApp } = createService();
    const result = service.input({ value, valueSelection });
    for (const key of keys) testApp.sendKey(key);
    testApp.sendKey("Enter");
    return result;
}

describe("QuickInputService.input: seeded value edges, as a browser input's setSelectionRange", () => {
    it("an empty selection only places the cursor: start", async () => {
        await expect(typeOver("abc", [0, 0])).resolves.toBe("xabc");
    });

    it("an empty selection only places the cursor: middle", async () => {
        await expect(typeOver("abc", [1, 1])).resolves.toBe("axbc");
    });

    it("an empty selection only places the cursor: end", async () => {
        await expect(typeOver("abc", [3, 3])).resolves.toBe("abcx");
    });

    it("a range past the end is clamped", async () => {
        await expect(typeOver("abc", [1, 99])).resolves.toBe("ax");
    });

    it("a range wholly past the end puts the cursor at the end", async () => {
        await expect(typeOver("abc", [50, 99])).resolves.toBe("abcx");
    });

    it("start after end collapses to the end offset", async () => {
        await expect(typeOver("abcd", [3, 1])).resolves.toBe("axbcd");
    });

    it("valueSelection without a value does not break typing", async () => {
        await expect(typeOver(undefined, [0, 5])).resolves.toBe("x");
    });

    it("an empty seed takes typing", async () => {
        await expect(typeOver("")).resolves.toBe("x");
    });

    it("Enter keeps a partly selected seed intact", async () => {
        await expect(typeOver("notes.txt", [0, 5], [])).resolves.toBe("notes.txt");
    });

    it("Backspace removes only the selected part", async () => {
        await expect(typeOver("notes.txt", [0, 5], ["Backspace"])).resolves.toBe(".txt");
    });

    it("Delete removes the whole selected seed", async () => {
        await expect(typeOver("name", undefined, ["Delete"])).resolves.toBe("");
    });

    it("a selection after an emoji counts string offsets", async () => {
        await expect(typeOver("😀a.txt", [2, 3])).resolves.toBe("😀x.txt");
    });

    it("a seed reopened after the first prompt is selected again", async () => {
        const { service, testApp } = createService();
        const first = service.input({ value: "one" });
        testApp.sendKey("Escape");
        await first;
        const second = service.input({ value: "two" });
        testApp.sendKey("x");
        testApp.sendKey("Enter");
        await expect(second).resolves.toBe("x");
    });
});
