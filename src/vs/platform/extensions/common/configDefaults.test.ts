import { describe, expect, it } from "vitest";

import { flattenConfigDefaults } from "./configDefaults.ts";

describe("flattenConfigDefaults", () => {
    it("одиночный блок: берёт default каждой properties-схемы", () => {
        expect(
            flattenConfigDefaults({
                title: "X",
                properties: {
                    "x.enabled": { type: "boolean", default: true },
                    "x.mode": { type: "string", default: "auto" },
                },
            }),
        ).toEqual({ "x.enabled": true, "x.mode": "auto" });
    });

    it("массив блоков сливается в одну map", () => {
        expect(
            flattenConfigDefaults([
                { properties: { "a.one": { default: 1 } } },
                { properties: { "b.two": { default: 2 } } },
            ]),
        ).toEqual({ "a.one": 1, "b.two": 2 });
    });

    it("схемы без default пропускаются; пустой результат → undefined", () => {
        expect(flattenConfigDefaults({ properties: { "x.noDefault": { type: "string" } } })).toBeUndefined();
        expect(flattenConfigDefaults({ title: "нет properties" })).toBeUndefined();
    });

    it("не-объектные значения схем (null, число) не роняют и не попадают в дефолты", () => {
        expect(
            flattenConfigDefaults({
                properties: {
                    "x.null": null,
                    "x.num": 5,
                    "x.ok": { default: true },
                } as never,
            }),
        ).toEqual({ "x.ok": true });
    });

    it("undefined-вклад → undefined", () => {
        expect(flattenConfigDefaults(undefined)).toBeUndefined();
    });
});
