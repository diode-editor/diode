// Test entry for treeWatcherMain.integration.test.ts: does what the DIODE_FILE_WATCHER
// branch in `main.ts` does, without the rest of the editor bootstrap.
import { runTreeWatcherSubprocess } from "./treeWatcherMain.ts";

runTreeWatcherSubprocess();

// Test-only from here: report our own environment AFTER entry. The role must not leak
// to descendants (`DIODE_FILE_WATCHER` unset, mode is node), and that can only be
// checked from inside the process.
process.send?.({
    t: "log",
    level: "info",
    message: "test-entry env",
    args: [
        {
            fileWatcher: process.env.DIODE_FILE_WATCHER ?? null,
            runAsNode: process.env.DIODE_RUN_AS_NODE ?? null,
        },
    ],
});
