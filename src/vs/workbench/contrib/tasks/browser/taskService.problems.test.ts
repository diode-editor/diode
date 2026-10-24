import { describe, expect, it } from "vitest";

import { buildTaskServiceHarness, tasksJsonOf } from "../../../../../TestUtils/taskServiceHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";

// The service's wiring of problem matchers: a tasks.json task, the `Tasks` log, open documents.

async function runOnly(h: ReturnType<typeof buildTaskServiceHarness>, lines: readonly string[], exitCode = 1) {
    const [task] = await h.service.getWorkspaceTasks();
    const done = h.service.run(task);
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.sessions.at(-1)?.emitLines(...lines);
    h.sessions.at(-1)?.emitExit(exitCode);
    await done;
}

function found(h: ReturnType<typeof buildTaskServiceHarness>): string[] {
    return h.markers.read().map((m) => `${m.owner} ${Uri.parse(m.resource).fsPath}: ${m.message}`);
}

describe("TaskService — problem matchers", () => {
    it("a tasks.json task with a built-in matcher puts its output into the marker service", async () => {
        const h = buildTaskServiceHarness({
            tasksJson: tasksJsonOf([
                { label: "lint", type: "shell", command: "eslint -f compact .", problemMatcher: "$eslint-compact" },
            ]),
        });
        await runOnly(h, ["/ws/app.js: line 1, col 7, Error - 'unused' is defined but never used. (no-unused-vars)"]);
        expect(found(h)).toStrictEqual(["eslint /ws/app.js: 'unused' is defined but never used."]);
        h.dispose();
    });

    it("an unknown matcher goes to the Tasks log", async () => {
        const h = buildTaskServiceHarness({
            tasksJson: tasksJsonOf([{ label: "lint", type: "shell", command: "x", problemMatcher: "$nope" }]),
        });
        await runOnly(h, []);
        expect(h.logger.warn).toHaveBeenCalledWith(
            "Problem matcher $nope can't be resolved. The matcher will be ignored",
        );
        h.dispose();
    });

    it("applyTo openDocuments: a document open in an editor gets the marker, a closed one does not", async () => {
        const h = buildTaskServiceHarness({
            tasksJson: tasksJsonOf([
                {
                    label: "lint",
                    type: "shell",
                    command: "x",
                    problemMatcher: { base: "$eslint-compact", applyTo: "openDocuments" },
                },
            ]),
        });
        h.openDocument("/ws/open.js");
        await runOnly(h, ["/ws/open.js: line 1, col 1, Error - a (r)", "/ws/closed.js: line 1, col 1, Error - b (r)"]);
        expect(found(h)).toStrictEqual(["eslint /ws/open.js: a"]);
        h.dispose();
    });
});
