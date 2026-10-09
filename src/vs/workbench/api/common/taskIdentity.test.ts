import { describe, expect, it, vi } from "vitest";

import {
    contributedTaskId,
    createTaskIdentifier,
    type ITaskDefinitionSchema,
    parseTaskDefinitions,
} from "./taskIdentity.ts";

// Ключ определения задачи (`KeyedTaskIdentifier` / `createTaskIdentifier`
// эталона) и разбор `contributes.taskDefinitions` — общий код хоста и
// субпроцесса: id задачи провайдера обе стороны обязаны считать одинаково.

const schema = (overrides: Partial<ITaskDefinitionSchema> = {}): ITaskDefinitionSchema => ({
    extensionId: "pub.ext",
    taskType: "bazel",
    required: [],
    properties: {},
    when: undefined,
    ...overrides,
});

describe("parseTaskDefinitions", () => {
    it("берёт тип, строковые required, копию properties и непустой when", () => {
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

    it("без required/properties/when — пустые; пустой или не строковый when — нет условия", () => {
        expect(parseTaskDefinitions("e", [{ type: "t", when: "" }], () => undefined)).toStrictEqual([
            { extensionId: "e", taskType: "t", required: [], properties: {}, when: undefined },
        ]);
        expect(
            parseTaskDefinitions("e", [{ type: "t", required: "x", properties: null, when: 5 }], () => undefined),
        ).toStrictEqual([{ extensionId: "e", taskType: "t", required: [], properties: {}, when: undefined }]);
    });

    it("запись без типа (или с пустым) пропускается с сообщением эталона; не массив — пусто", () => {
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
    it("без схемы — определение как есть, ключ — отсортированные пары, прежний _key выброшен", () => {
        const id = createTaskIdentifier({ type: "npm", script: "build", _key: "old" }, undefined, () => undefined);
        expect(id).toStrictEqual({ type: "npm", script: "build", _key: "script,build,type,npm," });
    });

    it("запятые в строках удваиваются, вложенные объекты — рекурсивно, числа — текстом", () => {
        const id = createTaskIdentifier(
            { type: "t", a: "x,y", nested: { b: 1, a: true }, list: ["p"] },
            undefined,
            () => undefined,
        );
        expect(id?._key).toBe("a,x,,y,list,0,p,,nested,a,true,b,1,,type,t,");
    });

    it("со схемой — только объявленные свойства и тип схемы", () => {
        const id = createTaskIdentifier(
            { type: "bazel", target: "//a", extra: "drop" },
            schema({ properties: { target: { type: "string" }, flags: { type: "string" } } }),
            () => undefined,
        );
        expect(id).toStrictEqual({ type: "bazel", target: "//a", _key: "target,//a,type,bazel," });
    });

    it("пропущенное обязательное: дефолт схемы, иначе ноль своего типа", () => {
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

    it("дефолт-объект копируется, а не разделяется", () => {
        const defaultValue = { a: 1 };
        const id = createTaskIdentifier(
            { type: "bazel" },
            schema({ required: ["opts"], properties: { opts: { type: "object", default: defaultValue } } }),
            () => undefined,
        );
        expect(id?.opts).toStrictEqual({ a: 1 });
        expect(id?.opts).not.toBe(defaultValue);
    });

    it("обязательное без дефолта и без простого типа — undefined и ошибка эталона", () => {
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

    it("необязательное отсутствующее свойство в ключ не попадает", () => {
        const id = createTaskIdentifier(
            { type: "bazel" },
            schema({ properties: { x: { type: "string" } } }),
            () => undefined,
        );
        expect(id).toStrictEqual({ type: "bazel", _key: "type,bazel," });
    });
});

describe("contributedTaskId", () => {
    it("расширение и ключ определения через точку", () => {
        expect(contributedTaskId("pub.ext", { type: "t", _key: "type,t," })).toBe("pub.ext.type,t,");
    });
});
