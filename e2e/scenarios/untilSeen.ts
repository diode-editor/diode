import type { ScenarioDriver } from "./framework.ts";

/**
 * Repeats an outside change (disk write, git) until the frame reacts: the watcher arms asynchronously,
 * and chokidar's `ignoreInitial` swallows anything written before the initial scan ends — the event is
 * lost for good (run 37195942480). This is a real watching gap (docs/TODO/FileTreePerformance.md, the
 * section on events lost in the arming window); until it is closed, a scenario models a neighbouring
 * terminal that keeps writing. `change` must produce a fresh event on every call.
 */
export async function changeUntilSeen(
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
