import { describeKilled, reapByEnv } from "../../src/TestUtils/processSweep.ts";

// e2e process cleanup, from narrow to wide:
//  1. `killGroup` — the editor's group (leader: `detached` for headless, `setsid` in node-pty); language
//     servers are not in it — the extension host subprocess has its own group (`extensionHostProcess.ts`);
//  2. `reapSession` — by the `DIODE_E2E_SESSION` marker: everything that outlived `dispose`, grandchildren included;
//  3. teardown of the run root (`src/TestUtils/tmpRoot.ts`) by `DIODE_TEST_TMP` — leftovers of a killed worker.

export const SESSION_MARKER_ENV = "DIODE_E2E_SESSION";

/** Off POSIX, signals the single process. Errors are swallowed: the group may be empty, the process gone. */
export function killGroup(child: { readonly pid?: number | undefined; kill(signal: NodeJS.Signals): boolean }, signal: NodeJS.Signals): void {
    const pid = child.pid;
    if (pid !== undefined && process.platform !== "win32") {
        try {
            process.kill(-pid, signal);
            return;
        } catch {
            // no group (already empty) — try the process itself below
        }
    }
    try {
        child.kill(signal);
    } catch {
        // already exited
    }
}

/**
 * Reaped processes are a leak: report to stderr but don't fail the test — it tests something else,
 * and the orphan no longer bothers its neighbors.
 */
export async function reapSession(sessionTag: string): Promise<void> {
    const killed = await reapByEnv(SESSION_MARKER_ENV, sessionTag);
    if (killed.length > 0) {
        console.error(`[e2e] killed processes that outlived the session (${String(killed.length)}):\n${describeKilled(killed)}`);
    }
}
