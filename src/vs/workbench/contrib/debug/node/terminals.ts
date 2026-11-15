/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/node/terminals.ts
// `hasChildProcesses` only; `prepareCommand` is string work and lives in `../common/terminals.ts`. The child is a
// `GuardedChildProcess`. Windows answers "busy" without asking: upstream reads the process tree there through
// `@vscode/windows-process-tree`, a native module diode doesn't ship — a busy terminal is just not reused.

import { spawn } from "node:child_process";

import { GuardedChildProcess } from "../../../../base/node/childProcessGuard.ts";

export function hasChildProcesses(processId: number | undefined, pgrep = "/usr/bin/pgrep"): Promise<boolean> {
    // fall back to safe side
    if (processId === undefined || processId === 0 || process.platform === "win32") {
        return Promise.resolve(true);
    }
    // if shell has at least one child process, assume that shell is busy
    const child = spawn(pgrep, ["-lP", String(processId)], { stdio: ["ignore", "pipe", "ignore"] });
    const guard = new GuardedChildProcess(child, { label: "pgrep", waitForStdio: true });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
        stdout += data;
    });
    return new Promise<boolean>((resolve) => {
        guard.onDidEnd((end) => {
            guard.dispose();
            if (end.error !== undefined) {
                resolve(true);
                return;
            }
            const r = stdout.trim();
            // ignore 'tmux'; see #43683
            resolve(r.length > 0 && !r.includes(" tmux"));
        });
    });
}
