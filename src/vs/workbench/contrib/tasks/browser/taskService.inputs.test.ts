import { describe, expect, it, vi } from "vitest";

import { makeTask } from "../../../../../TestUtils/taskFixtures.ts";
import { buildTaskServiceHarness } from "../../../../../TestUtils/taskServiceHarness.ts";
import { LAST_INPUTS } from "../../../services/configurationResolver/browser/configurationResolverService.ts";

const NAME_INPUT = { id: "name", type: "promptString", description: "Your name", default: "world" };

function tasksJson(task: Record<string, unknown>, inputs: readonly unknown[] = [NAME_INPUT]): string {
    return JSON.stringify({ version: "2.0.0", tasks: [{ label: "greet", type: "shell", ...task }], inputs });
}

type Harness = ReturnType<typeof buildTaskServiceHarness>;

async function workspaceTask(h: Harness) {
    const [task] = await h.service.getWorkspaceTasks();
    return task;
}

/** Runs the task in the background and waits until it has a terminal session. */
async function startTask(h: Harness, task: Parameters<Harness["service"]["run"]>[0]): Promise<void> {
    void h.service.run(task);
    await vi.waitFor(() => {
        expect(h.sessions).toHaveLength(1);
    });
}

describe("TaskService — ${input:…} and ${command:…}", () => {
    it("a promptString input of tasks.json is asked once before the start; its value goes to the command line", async () => {
        const h = buildTaskServiceHarness({
            tasksJson: tasksJson({ command: "echo", args: ["${input:name}", "again ${input:name}"] }),
        });
        h.answerInputs("Ann");
        await startTask(h, await workspaceTask(h));
        expect(h.inputs).toStrictEqual([{ prompt: "Your name", value: "world", password: false }]);
        expect(h.terminals.getInstances()[0].launch.shellArgs).toStrictEqual(["-c", "echo Ann 'again Ann'"]);
        // Remembered under the `tasks` section, as upstream.
        expect(h.state.get(LAST_INPUTS)).toStrictEqual([["tasks.name", "Ann"]]);
        h.dispose();
    });

    it("a pickString input; inputs in cwd and env too", async () => {
        const pick = { id: "mode", type: "pickString", description: "Mode", options: ["debug", "release"] };
        const h = buildTaskServiceHarness({
            tasksJson: tasksJson(
                { command: "make", options: { cwd: "${input:mode}", env: { MODE: "${input:mode}" } } },
                [pick],
            ),
        });
        h.answerPicks("release");
        await startTask(h, await workspaceTask(h));
        const { launch } = h.terminals.getInstances()[0];
        expect([launch.cwd, launch.env]).toStrictEqual(["/ws/release", { MODE: "release" }]);
        expect(h.picks).toHaveLength(1);
        h.dispose();
    });

    it("a cancelled input cancels the run: no terminal, no error", async () => {
        const h = buildTaskServiceHarness({ tasksJson: tasksJson({ command: "echo ${input:name}" }) });
        h.answerInputs(undefined);
        await expect(h.service.run(await workspaceTask(h))).resolves.toBeUndefined();
        expect(h.sessions).toStrictEqual([]);
        expect(h.notifications.passive()).toStrictEqual([]);
        h.dispose();
    });

    it("${command:id} runs the command; its string result is substituted", async () => {
        const h = buildTaskServiceHarness();
        const pick = vi.fn(() => Promise.resolve("4242"));
        h.commands.register("lldb.pickMyProcess", pick);
        await startTask(h, makeTask({ command: { name: "attach ${command:lldb.pickMyProcess}" } }));
        expect(pick).toHaveBeenCalledTimes(1);
        expect(h.terminals.getInstances()[0].launch.shellArgs).toStrictEqual(["-c", "attach 4242"]);
        h.dispose();
    });

    it("the window is read at the start: ${selectedText} of the active file editor", async () => {
        const h = buildTaskServiceHarness();
        h.setActiveEditor("/ws/a.ts");
        await expect(h.service.run(makeTask({ command: { name: "echo ${selectedText}" } }))).rejects.toThrow(
            "Make sure to have some text selected in the active editor.",
        );
        h.dispose();
    });

    it("an input without an inputs section — a toast with the upstream text, the task does not start", async () => {
        const h = buildTaskServiceHarness();
        await expect(h.service.run(makeTask({ command: { name: "echo ${input:name}" } }))).rejects.toThrow(
            "Variable 'name' must be defined in an 'inputs' section of the debug or task configuration.",
        );
        expect(h.notifications.passive()).toHaveLength(1);
        expect(h.sessions).toStrictEqual([]);
        h.dispose();
    });

    it("an input in an inline matcher's filePrefix is asked too", async () => {
        const h = buildTaskServiceHarness({ tasksJson: tasksJson({ command: "x" }) });
        h.answerInputs("sub");
        const matcher = { owner: "o", filePrefix: "${input:name}", pattern: [{ regexp: "^(.*)$", file: 1 }] };
        await startTask(h, makeTask({ problemMatchers: [matcher as never] }));
        expect(h.inputs).toHaveLength(1);
        h.dispose();
    });

    it("an already running task asks nothing: its instancePolicy decides", async () => {
        const h = buildTaskServiceHarness({
            tasksJson: tasksJson({ command: "echo ${input:name}", runOptions: { instancePolicy: "warn" } }),
        });
        h.answerInputs("Ann");
        const task = await workspaceTask(h);
        await startTask(h, task);
        void h.service.run(task);
        await vi.waitFor(() => {
            expect(h.notifications.passive()).toHaveLength(1);
        });
        expect(h.inputs).toHaveLength(1);
        h.dispose();
    });

    it("rerun: with reevaluation the input is asked again (cancelling it cancels the rerun); without — not", async () => {
        const h = buildTaskServiceHarness({ tasksJson: tasksJson({ command: "echo ${input:name}" }) });
        const openRunTask = vi.fn(() => Promise.resolve());
        h.answerInputs("Ann", "Bob", undefined);
        await startTask(h, await workspaceTask(h));
        h.sessions[0].emitExit(0);
        await h.service.rerun(openRunTask);
        expect(h.sessions[0].relaunches.at(-1)?.args).toStrictEqual(["-c", "echo Bob"]);
        h.sessions[0].emitExit(0);
        await h.service.rerun(openRunTask);
        expect(h.sessions[0].relaunches).toHaveLength(1);
        expect(h.inputs).toHaveLength(3);
        expect(openRunTask).not.toHaveBeenCalled();
        expect(h.notifications.passive()).toStrictEqual([]);
        h.dispose();

        const fixed = buildTaskServiceHarness({
            tasksJson: tasksJson({ command: "echo ${input:name}", runOptions: { reevaluateOnRerun: false } }),
        });
        fixed.answerInputs("Ann");
        await startTask(fixed, await workspaceTask(fixed));
        fixed.sessions[0].emitExit(0);
        await fixed.service.rerun(openRunTask);
        expect(fixed.sessions[0].relaunches.at(-1)?.args).toStrictEqual(["-c", "echo Ann"]);
        expect(fixed.inputs).toHaveLength(1);
        fixed.dispose();
    });
});
