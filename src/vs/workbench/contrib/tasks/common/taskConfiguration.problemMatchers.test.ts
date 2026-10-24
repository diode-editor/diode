import { describe, expect, it } from "vitest";

import { makeTask } from "../../../../../TestUtils/taskFixtures.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { ITaskDefinitionSchema } from "../../../api/common/taskIdentity.ts";

import { getBuiltinProblemMatcher } from "./problemMatcher.ts";
import { createCustomizedTask, parseTasksJson } from "./taskConfiguration.ts";

const folder: IWorkspaceFolder = { uri: Uri.file("/ws"), name: "ws", index: 0 };

const npmSchema: ITaskDefinitionSchema = {
    extensionId: "pub.ext",
    taskType: "npm",
    required: ["script"],
    properties: { script: { type: "string" } },
    when: undefined,
};

function parse(tasks: unknown[], platform: "linux" | "windows" = "linux") {
    return parseTasksJson(JSON.stringify({ version: "2.0.0", tasks }), folder, platform, (type) =>
        type === "npm" ? npmSchema : undefined,
    );
}

const inline = { owner: "mine", fileLocation: "absolute", pattern: { regexp: "^(.*):(\\d+) (.*)$", message: 3 } };

describe("parseTasksJson — problemMatcher forms", () => {
    it("a name stays a name (resolved at run): with and without $, unknown too", () => {
        const { tasks, problems } = parse([
            { label: "a", command: "x", problemMatcher: "$eslint-stylish" },
            { label: "b", command: "x", problemMatcher: ["go", "$nope"] },
            { label: "c", command: "x" },
        ]);
        expect(problems).toStrictEqual([]);
        expect(tasks.map((t) => [t.problemMatchers, t.hasDefinedMatchers])).toStrictEqual([
            [["$eslint-stylish"], true],
            [["go", "$nope"], true],
            [[], false],
        ]);
    });

    it("an inline object is parsed; an array mixes names and objects", () => {
        const { tasks, problems } = parse([
            { label: "a", command: "x", problemMatcher: inline },
            { label: "b", command: "x", problemMatcher: ["$go", { base: "$eslint-stylish", owner: "lint" }] },
        ]);
        expect(problems).toStrictEqual([]);
        expect(tasks[0].problemMatchers).toMatchObject([
            { owner: "mine", fileLocation: "absolute", pattern: { kind: "location", file: 1, line: 2, message: 3 } },
        ]);
        expect(tasks[1].problemMatchers).toStrictEqual([
            "$go",
            { ...getBuiltinProblemMatcher("eslint-stylish"), owner: "lint" },
        ]);
    });

    it("a broken inline matcher is reported and skipped; the task stays with the rest", () => {
        const { tasks, problems } = parse([
            { label: "a", command: "x", problemMatcher: ["$go", { owner: "o", pattern: { regexp: "(" } }, 7] },
        ]);
        expect(tasks.map((t) => [t._label, t.problemMatchers, t.hasDefinedMatchers])).toStrictEqual([
            ["a", ["$go"], true],
        ]);
        expect(problems).toStrictEqual([
            "Error: The string ( is not a valid regular expression.\n",
            `Error: the description can't be converted into a problem matcher:\n${JSON.stringify({ owner: "o", pattern: { regexp: "(" } }, null, 4)}\n`,
            `Error: the description can't be converted into a problem matcher:\n${JSON.stringify({}, null, 4)}\n`,
        ]);
    });

    it("the platform section's problemMatcher replaces the task's", () => {
        const task = { label: "a", command: "x", problemMatcher: "$go", windows: { problemMatcher: "$msCompile" } };
        expect(parse([task], "windows").tasks[0].problemMatchers).toStrictEqual(["$msCompile"]);
        expect(parse([task], "linux").tasks[0].problemMatchers).toStrictEqual(["$go"]);
        const onlyOs = parse([{ label: "b", command: "x", linux: { problemMatcher: "$go" } }]).tasks[0];
        expect([onlyOs.problemMatchers, onlyOs.hasDefinedMatchers]).toStrictEqual([["$go"], true]);
    });

    it("presentation.revealProblems: always, never, onProblem; anything else is onProblem (upstream)", () => {
        const reveal = (revealProblems: unknown) =>
            parse([{ label: "a", command: "x", presentation: { revealProblems } }]).tasks[0].command.presentation
                .revealProblems;
        expect([reveal("Always"), reveal("never"), reveal("onProblem"), reveal("sometimes"), reveal(1)]).toStrictEqual([
            "always",
            "never",
            "onProblem",
            "onProblem",
            "never",
        ]);
    });
});

describe("createCustomizedTask — matchers of the tasks.json entry win", () => {
    const contributed = makeTask({
        label: "build",
        extension: { type: "npm", extensionId: "pub.ext", source: "npm" },
        definition: { script: "build" },
        problemMatchers: ["$tsc"],
    });

    it("an inline matcher in the entry replaces the provider's names; no matcher keeps them", () => {
        const { configuring, problems } = parse([
            { type: "npm", script: "build", problemMatcher: inline },
            { type: "npm", script: "test", presentation: { revealProblems: "onProblem" } },
        ]);
        expect(problems).toStrictEqual([]);
        const customized = createCustomizedTask(contributed, configuring[0]);
        expect(customized.problemMatchers).toMatchObject([{ owner: "mine" }]);
        const kept = createCustomizedTask(contributed, configuring[1]);
        expect(kept.problemMatchers).toStrictEqual(["$tsc"]);
        expect(kept.command.presentation.revealProblems).toBe("onProblem");
    });

    it("an empty list in the entry turns the provider's matchers off", () => {
        const { configuring } = parse([{ type: "npm", script: "build", problemMatcher: [] }]);
        expect(createCustomizedTask(contributed, configuring[0]).problemMatchers).toStrictEqual([]);
    });
});
