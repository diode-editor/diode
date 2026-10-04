import { describe, expect, it } from "vitest";

import { collectConfigurationProperties } from "./configurationProperties.ts";

describe("collectConfigurationProperties", () => {
    it("одиночный блок: схемы по полному ключу", () => {
        expect(
            collectConfigurationProperties({
                title: "X",
                properties: {
                    "x.enabled": { type: "boolean", default: true },
                    "x.mode": { type: "string", default: "auto", scope: "resource" },
                },
            }),
        ).toEqual({
            "x.enabled": { type: "boolean", default: true },
            "x.mode": { type: "string", default: "auto", scope: "resource" },
        });
    });

    it("массив блоков сливается в одну map", () => {
        expect(
            collectConfigurationProperties([
                { properties: { "a.one": { default: 1 } } },
                { properties: { "b.two": { default: 2 } } },
            ]),
        ).toEqual({ "a.one": { default: 1 }, "b.two": { default: 2 } });
    });

    it("схема без default остаётся (ключ известен), блок без properties и не-объекты — пропуск", () => {
        expect(
            collectConfigurationProperties([
                { properties: { "x.noDefault": { type: "string" } } },
                { title: "нет properties" },
                { properties: { "x.broken": null as unknown as { default: unknown } } },
                { properties: { "x.scalar": "not a schema" as unknown as { default: unknown } } },
            ]),
        ).toEqual({ "x.noDefault": { type: "string" } });
        expect(collectConfigurationProperties(undefined)).toEqual({});
    });
});
