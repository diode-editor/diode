import { describe, expect, it } from "vitest";

import { QuickPickElement } from "./quickPickElement.ts";

/**
 * `inspectState` — публичный контракт: он едет по проводу инспектора и на него
 * смотрят e2e через `NodeSnapshot.state`. Меняется вместе с ними, не молча.
 */
describe("QuickPickElement — inspectState", () => {
    it("отдаёт запрос, активный индекс, заголовок и лейблы строк", () => {
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

    it("на свежем пикере — пустой запрос, нулевой индекс, пустой список", () => {
        expect(new QuickPickElement().inspectState()).toEqual({
            query: "",
            activeIndex: 0,
            title: undefined,
            items: [],
        });
    });
});
