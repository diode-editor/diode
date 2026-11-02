import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { makeTask } from "../../../../../TestUtils/taskFixtures.ts";
import { buildTaskServiceHarness, tasksJsonOf } from "../../../../../TestUtils/taskServiceHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IExtensionManifest } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import type { IContributingExtension } from "../common/problemMatcherRegistry.ts";

// Matchers contributed by extensions in tasks the service runs: by name, as `base`, and before the
// registry is ready.

function builtin(name: string): IContributingExtension {
    const path = resolve(import.meta.dirname, "../../../../../../extensions", name, "package.json");
    return { id: `vscode.${name}`, manifest: JSON.parse(readFileSync(path, "utf8")) as IExtensionManifest };
}

type Harness = ReturnType<typeof buildTaskServiceHarness>;

function settle(): Promise<void> {
    return new Promise((done) => setTimeout(done, 0));
}

async function finish(h: Harness, done: Promise<unknown>, lines: readonly string[]): Promise<void> {
    await settle();
    h.sessions.at(-1)?.emitLines(...lines);
    h.sessions.at(-1)?.emitExit(1);
    await done;
}

async function runFirst(h: Harness, lines: readonly string[]): Promise<void> {
    const [task] = await h.service.getWorkspaceTasks();
    await finish(h, h.service.run(task), lines);
}

function found(h: Harness): string[] {
    return h.markers
        .read()
        .map((m) => `${m.owner}/${m.source ?? ""}/${String(m.code)} ${Uri.parse(m.resource).fsPath}: ${m.message}`);
}

const TSC_ERRORS = [
    "src/a.ts(3,5): error TS2322: Type 'number' is not assignable to type 'string'.",
    "src/b.ts:7:1 - error TS2304: Cannot find name 'x'.",
];

describe("TaskService — matchers contributed by extensions", () => {
    it("`$tsc` of diode-lsp-typescript: both tsc output forms become markers, relative to the task's cwd", async () => {
        const h = buildTaskServiceHarness({
            matcherExtensions: [builtin("diode-lsp-typescript")],
            tasksJson: tasksJsonOf([{ label: "tsc", type: "shell", command: "tsc --noEmit", problemMatcher: "$tsc" }]),
        });
        await runFirst(h, TSC_ERRORS);
        expect(found(h)).toStrictEqual([
            "typescript/ts/2322 /ws/src/a.ts: Type 'number' is not assignable to type 'string'.",
            "typescript/ts/2304 /ws/src/b.ts: Cannot find name 'x'.",
        ]);
        expect(h.logger.warn).not.toHaveBeenCalled();
        h.dispose();
    });

    it("`$tsc` applies to closed documents only: an open one keeps its language server diagnostics", async () => {
        const h = buildTaskServiceHarness({
            matcherExtensions: [builtin("diode-lsp-typescript")],
            tasksJson: tasksJsonOf([{ label: "tsc", type: "shell", command: "tsc", problemMatcher: "$tsc" }]),
        });
        h.openDocument("/ws/src/a.ts");
        await runFirst(h, TSC_ERRORS);
        expect(found(h)).toStrictEqual(["typescript/ts/2304 /ws/src/b.ts: Cannot find name 'x'."]);
        h.dispose();
    });

    it('`$nvcc` of builtin cpp resolves in a tasks.json task instead of "can\'t be resolved"', async () => {
        const h = buildTaskServiceHarness({
            matcherExtensions: [builtin("cpp")],
            tasksJson: tasksJsonOf([{ label: "nvcc", type: "shell", command: "nvcc a.cu", problemMatcher: "$nvcc" }]),
        });
        await runFirst(h, ['a.cu(3): error: identifier "y" is undefined']);
        expect(found(h)).toStrictEqual(['cuda-cpp//undefined /ws/a.cu: identifier "y" is undefined']);
        expect(h.logger.warn).not.toHaveBeenCalled();
        h.dispose();
    });

    it("a contributed matcher is the `base` of an inline tasks.json matcher", async () => {
        const h = buildTaskServiceHarness({
            matcherExtensions: [builtin("diode-lsp-typescript")],
            tasksJson: tasksJsonOf([
                {
                    label: "tsc",
                    type: "shell",
                    command: "tsc",
                    problemMatcher: { base: "$tsc", owner: "mine", fileLocation: "absolute" },
                },
            ]),
        });
        await runFirst(h, ["/abs/c.ts(1,1): error TS1005: ';' expected."]);
        expect(found(h)).toStrictEqual(["mine/ts/1005 /abs/c.ts: ';' expected."]);
        h.dispose();
    });

    it("a provider's task refers to a contributed matcher by name", async () => {
        const h = buildTaskServiceHarness({ matcherExtensions: [builtin("diode-lsp-typescript")] });
        const task = makeTask({ label: "build", problemMatchers: ["$tsc"] });
        await finish(h, h.service.run(task), TSC_ERRORS.slice(0, 1));
        expect(found(h)).toStrictEqual([
            "typescript/ts/2322 /ws/src/a.ts: Type 'number' is not assignable to type 'string'.",
        ]);
        h.dispose();
    });

    it("a broken contributed pattern is reported under its extension's id", () => {
        const h = buildTaskServiceHarness({ matcherExtensions: null });
        const pattern = { name: "p", regexp: "(" };
        h.registerMatchers([
            {
                id: "pub.broken",
                manifest: { contributes: { problemPatterns: [pattern] } } as unknown as IExtensionManifest,
            },
        ]);
        expect(h.matcherProblems).toStrictEqual([
            "pub.broken: Error: The string ( is not a valid regular expression.\n",
            "pub.broken: Invalid problem pattern. The pattern will be ignored.",
            `pub.broken: ${JSON.stringify(pattern, undefined, 4)}`,
        ]);
        h.dispose();
    });

    it("a task run before the extensions' matchers are registered waits for them", async () => {
        const h = buildTaskServiceHarness({
            matcherExtensions: null,
            tasksJson: tasksJsonOf([{ label: "tsc", type: "shell", command: "tsc", problemMatcher: "$tsc" }]),
        });
        const configuration = h.service.getWorkspaceConfiguration();
        const run = h.service.run(makeTask({ label: "build", problemMatchers: ["$tsc"] }));
        await settle();
        expect(h.sessions).toHaveLength(0);
        h.registerMatchers([builtin("diode-lsp-typescript")]);
        const [task] = (await configuration).tasks;
        expect(task.problemMatchers).toStrictEqual(["$tsc"]);
        await finish(h, run, TSC_ERRORS.slice(1));
        expect(found(h)).toStrictEqual(["typescript/ts/2304 /ws/src/b.ts: Cannot find name 'x'."]);
        expect(h.logger.warn).not.toHaveBeenCalled();
        h.dispose();
    });

    it('an inline matcher with a contributed `base` waits for the registry too, not "can\'t be converted"', async () => {
        const h = buildTaskServiceHarness({
            matcherExtensions: null,
            tasksJson: tasksJsonOf([
                { label: "tsc", type: "shell", command: "tsc", problemMatcher: { base: "$tsc", owner: "mine" } },
            ]),
        });
        const configuration = h.service.getWorkspaceConfiguration();
        await settle();
        h.registerMatchers([builtin("diode-lsp-typescript")]);
        const [task] = (await configuration).tasks;
        expect(task.problemMatchers).toMatchObject([{ owner: "mine", source: "ts" }]);
        expect(h.logger.warn).not.toHaveBeenCalled();
        h.dispose();
    });
});
