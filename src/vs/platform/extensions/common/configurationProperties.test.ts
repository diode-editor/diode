import { describe, expect, it } from "vitest";

import { collectConfigurationProperties } from "./configurationProperties.ts";

describe("collectConfigurationProperties", () => {
    it("single block: schemas keyed by full key", () => {
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

    it("an array of blocks merges into one map", () => {
        expect(
            collectConfigurationProperties([
                { properties: { "a.one": { default: 1 } } },
                { properties: { "b.two": { default: 2 } } },
            ]),
        ).toEqual({ "a.one": { default: 1 }, "b.two": { default: 2 } });
    });

    it("a schema without default is kept (the key is known); a block without properties and non-objects are skipped", () => {
        expect(
            collectConfigurationProperties([
                { properties: { "x.noDefault": { type: "string" } } },
                { title: "no properties" },
                { properties: { "x.broken": null as unknown as { default: unknown } } },
                { properties: { "x.scalar": "not a schema" as unknown as { default: unknown } } },
            ]),
        ).toEqual({ "x.noDefault": { type: "string" } });
        expect(collectConfigurationProperties(undefined)).toEqual({});
    });
});
