import { describe, expect, it } from "vitest";

import { QuickPickElement } from "./quickPickElement.ts";

describe("QuickPickElement.inspectState", () => {
    it("reports query, item labels, active index and title", () => {
        const picker = new QuickPickElement();
        picker.title = "Go to File";
        picker.items = [{ label: "alpha.ts" }, { label: "beta.ts" }, { label: "gamma.ts" }];
        picker.setQuery("eta");

        expect(picker.inspectState()).toEqual({
            query: "eta",
            activeIndex: 0,
            title: "Go to File",
            items: ["alpha.ts", "beta.ts", "gamma.ts"],
        });
    });
});
