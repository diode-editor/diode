import { describe, expect, it } from "vitest";

import { collectDebuggers, configurationAttributes, configurationSnippets } from "./launchSchema.ts";

describe("collectDebuggers", () => {
    it("takes only well-formed contributions of well-formed manifests", () => {
        const debuggers = collectDebuggers([
            null,
            "garbage",
            {},
            { contributes: 1 },
            { contributes: { debuggers: { type: "not-an-array", label: "No" } } },
            {
                contributes: {
                    debuggers: [
                        null,
                        "garbage",
                        { label: "No type" },
                        { type: 42, label: "Number" },
                        { type: "", label: "Empty" },
                        { type: "good", label: "Good" },
                    ],
                },
            },
        ]);
        expect([...debuggers.keys()]).toEqual(["good"]);
    });

    it("merges the contributions of one type: the first label, attributes per request, all snippets", () => {
        const snippet = { label: "S", body: {} };
        const debuggers = collectDebuggers([
            {
                contributes: {
                    debuggers: [
                        {
                            type: "t",
                            configurationAttributes: { launch: { properties: { a: { type: "string" } } } },
                            configurationSnippets: [snippet, null, { body: {} }, { label: "no body" }],
                        },
                    ],
                },
            },
            {
                contributes: {
                    debuggers: [
                        {
                            type: "t",
                            label: "First",
                            deprecated: "Old.",
                            configurationAttributes: {
                                launch: { properties: { b: { type: "number" }, bad: "integer" } },
                                attach: {},
                                broken: "x",
                            },
                            configurationSnippets: [snippet],
                        },
                        { type: "t", label: "Second", program: "./adapter" },
                    ],
                },
            },
        ]);
        const t = debuggers.get("t");
        expect(t).toMatchObject({ label: "First", isMain: true, deprecated: "Old." });
        expect(Object.fromEntries(t?.requests ?? [])).toEqual({
            launch: { a: { type: "string" }, b: { type: "number" } },
            attach: {},
            broken: {},
        });
        expect(configurationSnippets(debuggers)).toEqual([snippet, snippet]);
    });

    it("a contribution without label, program or runtime is not a debugger of its own", () => {
        const only = (contribution: object) =>
            collectDebuggers([{ contributes: { debuggers: [{ type: "t", ...contribution }] } }]).get("t")?.isMain;
        expect(only({})).toBe(false);
        expect(only({ program: "./a" })).toBe(true);
        expect(only({ runtime: "node" })).toBe(true);
    });
});

describe("configurationAttributes", () => {
    const debuggers = collectDebuggers([
        {
            contributes: {
                debuggers: [
                    {
                        type: "attachOnly",
                        label: "Attach Only",
                        configurationAttributes: { attach: { properties: { pid: { type: "number" } } } },
                    },
                    { type: "plain", label: "Plain" },
                    { type: "unlabeled", runtime: "node" },
                    { type: "hidden", label: "Hidden", deprecated: "Gone." },
                    { type: "addon" },
                ],
            },
        },
    ]);

    it("`type` lists the debuggers of their own that are not deprecated, described by their labels", () => {
        expect(configurationAttributes(debuggers, "", "").type).toEqual({
            enum: ["attachOnly", "plain", "unlabeled"],
            enumDescriptions: ["Attach Only", "Plain", "unlabeled"],
            description: "Type of configuration.",
        });
    });

    it("`request` lists the debugger's requests; launch and attach for a debugger without attributes", () => {
        expect(configurationAttributes(debuggers, "attachOnly", "").request).toEqual({
            enum: ["attach"],
            description: 'Request type of configuration. Can be "launch" or "attach".',
        });
        expect(configurationAttributes(debuggers, "plain", "").request.enum).toEqual(["launch", "attach"]);
        expect(configurationAttributes(debuggers, "", "").request.enum).toEqual(["launch", "attach"]);
    });

    it("the debugger's attributes come first, the request's own when it is known", () => {
        expect(Object.keys(configurationAttributes(debuggers, "attachOnly", "attach"))[0]).toBe("pid");
        expect(Object.keys(configurationAttributes(debuggers, "attachOnly", "launch"))[0]).toBe("pid");
        expect(Object.keys(configurationAttributes(debuggers, "plain", "launch"))[0]).toBe("type");
    });
});
