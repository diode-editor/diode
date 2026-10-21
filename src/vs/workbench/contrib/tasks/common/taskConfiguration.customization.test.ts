import { describe, expect, it } from "vitest";

import { makeTask } from "../../../../../TestUtils/taskFixtures.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { ITaskDefinitionSchema } from "../../../api/common/taskIdentity.ts";

import { createCustomizedTask, parseTasksJson } from "./taskConfiguration.ts";
import { DEFAULT_RUN_OPTIONS } from "./tasks.ts";

const folder: IWorkspaceFolder = { uri: Uri.file("/ws"), name: "ws", index: 0 };

const npmSchema: ITaskDefinitionSchema = {
    extensionId: "pub.ext",
    taskType: "npm",
    required: ["script"],
    properties: { script: { type: "string" }, path: { type: "string" } },
    when: undefined,
};

const lookup = (type: string) => (type === "npm" ? npmSchema : undefined);

function configure(tasks: unknown[], platform: "linux" | "windows" = "linux") {
    return parseTasksJson(JSON.stringify({ version: "2.0.0", tasks }), folder, platform, lookup);
}

describe("parseTasksJson — кастомизации задач провайдеров", () => {
    it("запись с типом провайдера — кастомизация: ключ по схеме, id расширения, индекс записи, поля", () => {
        const element = {
            type: "npm",
            script: "build",
            extra: 1,
            label: "Build it",
            detail: "d",
            hide: true,
            group: { kind: "build", isDefault: true },
            isBackground: true,
            problemMatcher: "$tsc",
            presentation: { echo: false },
            options: { cwd: "sub" },
            runOptions: { instancePolicy: "silent" },
        };
        const { tasks, configuring, problems } = configure([{ label: "own", command: "x" }, element]);
        expect(problems).toStrictEqual([]);
        expect(tasks.map((t) => [t._label, t.configIndex])).toStrictEqual([["own", 0]]);
        expect(configuring).toStrictEqual([
            {
                _id: "pub.ext.script,build,type,npm,",
                _label: "Build it",
                type: "npm",
                configures: { type: "npm", script: "build", _key: "script,build,type,npm," },
                folder,
                configIndex: 1,
                customization: {
                    label: "Build it",
                    detail: "d",
                    hide: true,
                    group: { id: "build", isDefault: true },
                    isBackground: true,
                    problemMatchers: ["$tsc"],
                    presentation: { echo: false },
                    options: { cwd: "sub" },
                    runOptions: { ...DEFAULT_RUN_OPTIONS, instancePolicy: "silent" },
                },
                element,
            },
        ]);
    });

    it("без label — «тип: первое обязательное», без него — тип; секция платформы поверх; лишнего нет", () => {
        const [withScript, bare] = configure(
            [
                { type: "npm", script: "lint", windows: { options: { cwd: "w" }, presentation: { focus: true } } },
                { type: "npm", script: "" },
            ],
            "windows",
        ).configuring;
        expect(withScript._label).toBe("npm: lint");
        expect(withScript.customization).toStrictEqual({
            presentation: { focus: true },
            options: { cwd: "w" },
            runOptions: DEFAULT_RUN_OPTIONS,
        });
        expect(bare._label).toBe("npm");
        expect(bare.customization).toStrictEqual({ presentation: {}, runOptions: DEFAULT_RUN_OPTIONS });
    });

    it("label не строкой или пустой — подпись по обязательному; обязательное не строкой — JSON", () => {
        const labels = configure([
            { type: "npm", script: "a", label: 5 },
            { type: "npm", script: "b", label: "" },
        ]).configuring.map((c) => [c._label, c.customization.label]);
        expect(labels).toStrictEqual([
            ["npm: a", undefined],
            ["npm: b", undefined],
        ]);
        const objectSchema: ITaskDefinitionSchema = { ...npmSchema, required: ["spec"], properties: { spec: {} } };
        const [withObject] = parseTasksJson(
            JSON.stringify({ version: "2.0.0", tasks: [{ type: "npm", spec: { a: 1 } }] }),
            folder,
            "linux",
            () => objectSchema,
        ).configuring;
        expect(withObject._label).toBe('npm: {"a":1}');
    });

    it("незнакомый тип, тип не строкой, dependsOn, кривые опции — сообщения эталона", () => {
        const { configuring, problems } = configure([
            { type: 1, label: "t" },
            { type: "", label: "e" },
            { type: "bazel", label: "b" },
            { type: "npm", script: "a", dependsOn: ["b"], options: { cwd: 1 } },
        ]);
        expect(configuring.map((c) => c._label)).toStrictEqual(["npm: a"]);
        expect(problems[0]).toMatch(
            /^Error: tasks configuration must have a type property\. The configuration will be ignored\.\n\{\n {4}"type": 1,/u,
        );
        expect(problems[1]).toMatch(
            /^Error: tasks configuration must have a type property\. The configuration will be ignored\.\n\{\n {4}"type": "",/u,
        );
        expect(problems.slice(2)).toStrictEqual([
            "Error: there is no registered task type 'bazel'. Did you miss installing an extension that provides a corresponding task provider?",
            "Warning: options.cwd must be of type string. Ignoring value 1",
            "Warning: task 'npm': dependsOn is not supported; the task runs without its dependencies.",
        ]);
    });

    it("определение негодно по схеме — ошибка эталона, запись пропускается", () => {
        const strict: ITaskDefinitionSchema = { ...npmSchema, required: ["obj"], properties: { obj: {} } };
        const { configuring, problems } = parseTasksJson(
            JSON.stringify({ version: "2.0.0", tasks: [{ type: "npm" }] }),
            folder,
            "linux",
            () => strict,
        );
        expect(configuring).toStrictEqual([]);
        // Сначала — сообщение схемы о негодном обязательном свойстве, затем — эталонное «unknown type».
        expect(problems).toHaveLength(2);
        expect(problems.at(-1)).toBe(
            `Error: the task configuration '{"type":"npm"}' is using an unknown type. The task configuration will be ignored.`,
        );
    });

    it("без схем (по умолчанию) — запись с типом провайдера не кастомизация, а ошибка", () => {
        const result = parseTasksJson(
            JSON.stringify({ version: "2.0.0", tasks: [{ type: "npm", script: "a" }] }),
            folder,
            "linux",
        );
        expect(result.configuring).toStrictEqual([]);
        expect(result.problems).toHaveLength(1);
    });
});

describe("createCustomizedTask", () => {
    const contributed = makeTask({
        label: "build",
        extension: { type: "npm", extensionId: "pub.ext", source: "npm" },
        definition: { script: "build" },
        command: { name: "npm run build", options: { cwd: "/p", env: { A: "1" } } },
        presentation: { reveal: "silent" },
        detail: "tsc",
        isBackground: true,
    });

    it("заданное в записи — поверх задачи провайдера; id, определение и исполнение — провайдера", () => {
        const [configuring] = configure([
            { type: "npm", script: "build", label: "B", presentation: { echo: false }, options: { env: { B: "2" } } },
        ]).configuring;
        expect(createCustomizedTask({ ...contributed, group: { id: "build" } }, configuring)).toStrictEqual({
            ...contributed,
            _label: "B",
            name: "B",
            command: {
                ...contributed.command,
                options: { cwd: "/p", env: { A: "1", B: "2" } },
                presentation: { ...contributed.command.presentation, echo: false },
            },
            group: { id: "build" },
            configIndex: 0,
        });
    });

    it("подробность, скрытие, фон, матчеры, группа и runOptions записи перекрывают провайдера", () => {
        const [full] = configure([
            {
                type: "npm",
                script: "build",
                detail: "mine",
                hide: true,
                isBackground: false,
                problemMatcher: [],
                group: "test",
                runOptions: { reevaluateOnRerun: false },
            },
        ]).configuring;
        expect(createCustomizedTask({ ...contributed, problemMatchers: ["$tsc"] }, full)).toMatchObject({
            _label: "npm: build",
            detail: "mine",
            hide: true,
            isBackground: false,
            problemMatchers: [],
            group: { id: "test" },
            runOptions: { ...DEFAULT_RUN_OPTIONS, reevaluateOnRerun: false },
        });
    });

    it("пустая запись над задачей без опций, подробности и группы — ключей не добавляет", () => {
        const bare = makeTask({
            extension: { type: "npm", extensionId: "pub.ext", source: "npm" },
            command: { runtime: "custom" },
        });
        const [plain] = configure([{ type: "npm", script: "x" }]).configuring;
        const customized = createCustomizedTask(bare, plain);
        expect(customized.command).toStrictEqual(bare.command);
        expect(Object.keys(customized).filter((key) => ["detail", "group", "hide"].includes(key))).toStrictEqual([]);
    });
});
