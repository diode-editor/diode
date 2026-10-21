import { describe, expect, it, vi } from "vitest";

import {
    contributedTaskId,
    createTaskIdentifier,
    type ITaskDefinitionSchema,
    parseTaskDefinitions,
} from "./taskIdentity.ts";

const schema = (overrides: Partial<ITaskDefinitionSchema> = {}): ITaskDefinitionSchema => ({
    extensionId: "pub.ext",
    taskType: "bazel",
    required: [],
    properties: {},
    when: undefined,
    ...overrides,
});

describe("parseTaskDefinitions", () => {
    it("takes the type, string required entries, a copy of properties and a non-empty when", () => {
        const properties = { target: { type: "string" } };
        const [parsed] = parseTaskDefinitions(
            "pub.ext",
            [{ type: "bazel", required: ["target", 3], properties, when: "shellExecutionSupported" }],
            () => undefined,
        );
        expect(parsed).toStrictEqual({
            extensionId: "pub.ext",
            taskType: "bazel",
            required: ["target"],
            properties: { target: { type: "string" } },
            when: "shellExecutionSupported",
        });
        expect(parsed.properties).not.toBe(properties);
    });

    it("without required/properties/when — empty; an empty or non-string when means no condition", () => {
        expect(parseTaskDefinitions("e", [{ type: "t", when: "" }], () => undefined)).toStrictEqual([
            { extensionId: "e", taskType: "t", required: [], properties: {}, when: undefined },
        ]);
        expect(
            parseTaskDefinitions("e", [{ type: "t", required: "x", properties: null, when: 5 }], () => undefined),
        ).toStrictEqual([{ extensionId: "e", taskType: "t", required: [], properties: {}, when: undefined }]);
    });

    it("an entry without a type (or with an empty one) is skipped with the upstream message; not an array — empty", () => {
        const report = vi.fn();
        expect(parseTaskDefinitions("e", [{}, { type: "" }, null, { type: 1 }, { type: "ok" }], report)).toHaveLength(
            1,
        );
        expect(report).toHaveBeenCalledTimes(4);
        expect(report).toHaveBeenCalledWith("The task type configuration is missing the required 'taskType' property");
        expect(parseTaskDefinitions("e", { type: "t" }, report)).toStrictEqual([]);
    });
});

describe("createTaskIdentifier", () => {
    it("without a schema — the definition as is, the key is sorted pairs, the old _key is dropped", () => {
        const id = createTaskIdentifier({ type: "npm", script: "build", _key: "old" }, undefined, () => undefined);
        expect(id).toStrictEqual({ type: "npm", script: "build", _key: "script,build,type,npm," });
    });

    it("commas in strings are doubled, nested objects recursively, numbers as text", () => {
        const id = createTaskIdentifier(
            { type: "t", a: "x,y", nested: { b: 1, a: true }, list: ["p"] },
            undefined,
            () => undefined,
        );
        expect(id?._key).toBe("a,x,,y,list,0,p,,nested,a,true,b,1,,type,t,");
    });

    it("with a schema — only declared properties and the schema type", () => {
        const id = createTaskIdentifier(
            { type: "bazel", target: "//a", extra: "drop" },
            schema({ properties: { target: { type: "string" }, flags: { type: "string" } } }),
            () => undefined,
        );
        expect(id).toStrictEqual({ type: "bazel", target: "//a", _key: "target,//a,type,bazel," });
    });

    it("a missing required property: the schema default, otherwise the zero value of its type", () => {
        const id = createTaskIdentifier(
            { type: "bazel", target: null },
            schema({
                required: ["target", "verbose", "jobs", "level", "name"],
                properties: {
                    target: { type: "string", default: "//..." },
                    verbose: { type: "boolean" },
                    jobs: { type: "number" },
                    level: { type: "integer" },
                    name: { type: "string" },
                },
            }),
            () => undefined,
        );
        expect(id).toStrictEqual({
            type: "bazel",
            target: "//...",
            verbose: false,
            jobs: 0,
            level: 0,
            name: "",
            _key: "jobs,0,level,0,name,,target,//...,type,bazel,verbose,false,",
        });
    });

    it("a default object is copied, not shared", () => {
        const defaultValue = { a: 1 };
        const id = createTaskIdentifier(
            { type: "bazel" },
            schema({ required: ["opts"], properties: { opts: { type: "object", default: defaultValue } } }),
            () => undefined,
        );
        expect(id?.opts).toStrictEqual({ a: 1 });
        expect(id?.opts).not.toBe(defaultValue);
    });

    it("required without a default and without a simple type — undefined and the upstream error", () => {
        const report = vi.fn();
        const id = createTaskIdentifier(
            { type: "bazel" },
            schema({
                required: ["opts", "other"],
                properties: { opts: { type: "object" }, other: { type: "constructor" } },
            }),
            report,
        );
        expect(id).toBeUndefined();
        expect(report).toHaveBeenCalledWith(
            `Error: the task identifier '{"type":"bazel"}' is missing the required property 'opts'. The task identifier will be ignored.`,
        );
        const report2 = vi.fn();
        expect(
            createTaskIdentifier(
                { type: "bazel" },
                schema({ required: ["x"], properties: { x: { type: "constructor" } } }),
                report2,
            ),
        ).toBeUndefined();
        expect(report2).toHaveBeenCalledTimes(1);
    });

    it("an optional missing property is left out of the key", () => {
        const id = createTaskIdentifier(
            { type: "bazel" },
            schema({ properties: { x: { type: "string" } } }),
            () => undefined,
        );
        expect(id).toStrictEqual({ type: "bazel", _key: "type,bazel," });
    });
});

describe("contributedTaskId", () => {
    it("extension and definition key joined by a dot", () => {
        expect(contributedTaskId("pub.ext", { type: "t", _key: "type,t," })).toBe("pub.ext.type,t,");
    });
});
