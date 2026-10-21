import { describe, expect, it } from "vitest";

import { QuickPickElement } from "./quickPickElement.ts";

/** Public contract: sent over the inspector wire and into e2e (`NodeSnapshot.state`); change them together. */
describe("QuickPickElement — inspectState", () => {
    it("returns the query, active index, title and row labels", () => {
        const picker = new QuickPickElement();
        picker.title = "Go to File";
        picker.items = [{ label: "main.ts" }, { label: "index.ts" }];
        picker.setQuery("ts");
        picker.setActiveIndex(1);

        expect(picker.inspectState()).toEqual({
            query: "ts",
            activeIndex: 1,
            title: "Go to File",
            items: ["main.ts", "index.ts"],
        });
    });

    it("a fresh picker has an empty query, index zero and an empty list", () => {
        expect(new QuickPickElement().inspectState()).toEqual({
            query: "",
            activeIndex: 0,
            title: undefined,
            items: [],
        });
    });
});
