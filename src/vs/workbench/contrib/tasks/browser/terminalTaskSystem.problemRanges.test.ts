import { describe, expect, it } from "vitest";

import { buildTerminalTaskSystemHarness } from "../../../../../TestUtils/terminalTaskSystemHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { parseTasksJson } from "../common/taskConfiguration.ts";

// A tasks.json pattern with `line` and no `column`: the column defaults to group 3 (upstream
// `doCreateSingleProblemPattern`), and when that group is not a number the column is NaN. Upstream's
// MarkerService sanitizes it to column 1. Here NaN reached the user: "Col NaN" in Problems, the cursor at
// "Col NaN" after Enter on the problem, and no squiggle for any problem of that file.

const folder: IWorkspaceFolder = { uri: Uri.file("/ws"), name: "ws", index: 0 };

describe("TerminalTaskSystem — problem ranges from tasks.json", () => {
    it("a non-numeric column group gives column 1, not NaN", async () => {
        const { tasks, problems } = parseTasksJson(
            JSON.stringify({
                version: "2.0.0",
                tasks: [
                    {
                        label: "lint",
                        command: "x",
                        problemMatcher: {
                            owner: "lineonly",
                            fileLocation: "absolute",
                            pattern: { regexp: "^(\\S+) (\\d+) (.*)$", file: 1, line: 2, message: 3 },
                        },
                    },
                ],
            }),
            folder,
            "linux",
            () => undefined,
        );
        expect(problems).toStrictEqual([]);
        const h = buildTerminalTaskSystemHarness();
        const result = h.system.run(tasks[0], h.context());
        h.sessions[0].emitLines("/ws/src/a.ts 3 sev-default");
        h.sessions[0].emitExit(1);
        await result.promise;
        const [marker] = h.markers.read({ owner: "lineonly" });
        expect(marker.message).toBe("sev-default");
        const { start, end } = marker.range;
        expect([start.line, start.character, end.line, end.character].every(Number.isFinite)).toBe(true);
        expect(start).toStrictEqual({ line: 2, character: 0 });
        h.dispose();
    });
});
