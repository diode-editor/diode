import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario, type ScenarioDriver } from "./framework.ts";

// The workspace changes via `mkdirSync`/`writeFileSync`, not the editor: like cmake configuring a
// project in a neighbouring terminal, the new `build/` must show up in the Explorer on its own,
// without expanding anything or pressing Refresh (#1263).

function makeWorkspace(): string {
    const dir = mkdtempSync(join(tmpdir(), "diode-root-watch-demo-"));
    writeFileSync(join(dir, "a.txt"), "hi\n");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "b.txt"), "x\n");
    return dir;
}

const workspaceDir = makeWorkspace();

/**
 * Repeats the change until the tree reacts: the watcher process arms asynchronously, and chokidar's
 * `ignoreInitial` swallows anything written before the initial scan ends (docs/TODO/FileTreePerformance.md,
 * the section on events lost in the arming window); same model as scmLiveWatch.scenario.ts.
 */
async function changeUntilSeen(
    editor: ScenarioDriver,
    change: () => void,
    predicate: (text: string) => boolean,
): Promise<void> {
    const attempts = 5;
    for (let attempt = 1; ; attempt++) {
        change();
        try {
            await editor.waitForText(predicate, { timeoutMs: 3000 });
            return;
        } catch (err) {
            if (attempt === attempts) throw err;
        }
    }
}

export default defineScenario({
    name: "explorer-root-watch",
    title: "Explorer shows a folder created in the workspace root outside the editor",
    open: [workspaceDir],
    cols: 100,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("a.txt") && t.includes("sub"));
        await editor.capture("before");

        const build = join(workspaceDir, "build");
        await changeUntilSeen(
            editor,
            () => {
                // A fresh create on every attempt — an existing folder makes no event.
                rmSync(build, { recursive: true, force: true });
                mkdirSync(join(build, "CMakeFiles"), { recursive: true });
                writeFileSync(join(build, "CMakeCache.txt"), "");
            },
            (t) => t.includes("build"),
        );
        await editor.capture("build-appeared");
    },
});
