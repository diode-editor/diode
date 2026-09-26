import { describe, expect, it } from "vitest";

import { parseWireExtensionActivated, parseWireExtensionCatalog } from "./wireTypes.ts";

describe("parseWireExtensionCatalog", () => {
    it("разбирает полный каталог", () => {
        expect(
            parseWireExtensionCatalog({
                extensions: [
                    { id: "pub.one", extensionPath: "/ext/one", packageJSON: { name: "one" }, isActive: true },
                    { id: "pub.two", extensionPath: "/ext/two", packageJSON: { name: "two" }, isActive: false },
                ],
            }),
        ).toEqual({
            extensions: [
                { id: "pub.one", extensionPath: "/ext/one", packageJSON: { name: "one" }, isActive: true },
                { id: "pub.two", extensionPath: "/ext/two", packageJSON: { name: "two" }, isActive: false },
            ],
        });
    });

    it("порядок записей сохраняется — по нему субпроцесс решает, менялся ли состав", () => {
        const parsed = parseWireExtensionCatalog({
            extensions: [
                { id: "pub.two", extensionPath: "/b", packageJSON: {}, isActive: false },
                { id: "pub.one", extensionPath: "/a", packageJSON: {}, isActive: false },
            ],
        });
        expect(parsed?.extensions.map((e) => e.id)).toEqual(["pub.two", "pub.one"]);
    });

    it("isActive — строго `true`, всё остальное значит «неактивно»", () => {
        const parsed = parseWireExtensionCatalog({
            extensions: [
                { id: "pub.one", extensionPath: "/a", packageJSON: {}, isActive: 1 },
                { id: "pub.two", extensionPath: "/b", packageJSON: {} },
            ],
        });
        expect(parsed?.extensions.map((e) => e.isActive)).toEqual([false, false]);
    });

    it.each([
        ["строкой", "не объект"],
        // `typeof null === "object"` — без отдельной проверки на null он проехал
        // бы в `packageJSON`, а расширения читают его без оглядки (`ext.packageJSON.name`).
        ["null", null],
        ["отсутствующим", undefined],
    ])("манифест %s становится пустым объектом, но запись остаётся", (_name, packageJSON) => {
        const parsed = parseWireExtensionCatalog({
            extensions: [{ id: "pub.one", extensionPath: "/a", packageJSON, isActive: true }],
        });
        expect(parsed?.extensions).toEqual([{ id: "pub.one", extensionPath: "/a", packageJSON: {}, isActive: true }]);
    });

    it("негодные записи выбрасываются поштучно, годные доезжают", () => {
        const parsed = parseWireExtensionCatalog({
            extensions: [
                null,
                // Дырка в массиве: на ней разыменование `entry.id` бросило бы
                // TypeError и унесло весь каталог, а не одну запись.
                undefined,
                "строка",
                { extensionPath: "/a", packageJSON: {} },
                { id: "", extensionPath: "/a", packageJSON: {} },
                { id: "pub.nopath", packageJSON: {} },
                { id: "pub.emptypath", extensionPath: "", packageJSON: {} },
                { id: "pub.ok", extensionPath: "/ok", packageJSON: {}, isActive: true },
            ],
        });
        expect(parsed?.extensions.map((e) => e.id)).toEqual(["pub.ok"]);
    });

    it.each([
        ["не объект", "каталог"],
        ["null", null],
        ["без поля extensions", {}],
        ["extensions не массив", { extensions: { "pub.one": {} } }],
    ])("отвергает целиком: %s", (_name, raw) => {
        expect(parseWireExtensionCatalog(raw)).toBeNull();
    });

    it("пустой каталог — это валидный каталог, а не отказ", () => {
        expect(parseWireExtensionCatalog({ extensions: [] })).toEqual({ extensions: [] });
    });
});

describe("parseWireExtensionActivated", () => {
    it("отдаёт id", () => {
        expect(parseWireExtensionActivated({ id: "pub.one" })).toBe("pub.one");
    });

    it.each([
        ["не объект", "pub.one"],
        ["null", null],
        ["пустой id", { id: "" }],
        ["нестроковый id", { id: 42 }],
    ])("отвергает: %s", (_name, raw) => {
        expect(parseWireExtensionActivated(raw)).toBeNull();
    });
});
