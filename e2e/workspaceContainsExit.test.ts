import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import yazl from "yazl";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Issue #825: `workspaceContains:**\/*.tf` on a home directory with a cold FUSE mount. The glob search is an rg
 * subprocess now, so a hung walk is a process to kill, not a `readdir` in the libuv pool that `process.exit`
 * waits for. The fake rg stands in for the hung walk (`DIODE_RIPGREP_PATH`): only the `workspaceContains`
 * search hangs, Quick Open's index (`rg --files` without include globs) gets an empty list at once.
 */

/** The shutdown phase is capped at ~2 s; the rest is headroom for a loaded machine. */
const EXIT_BUDGET_MS = 5000;

function writeZip(file: string, entries: Readonly<Record<string, string>>): Promise<void> {
    return new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        for (const [name, content] of Object.entries(entries)) zip.addBuffer(Buffer.from(content), name);
        const out = fs.createWriteStream(file);
        out.on("close", () => {
            resolve();
        });
        out.on("error", reject);
        zip.outputStream.on("error", reject);
        zip.outputStream.pipe(out);
        zip.end();
    });
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

describe.skipIf(process.platform === "win32")("SEA binary — exit while a workspaceContains search hangs", () => {
    let dir: string;
    let vsix: string;
    let fakeRg: string;
    let pidFile: string;

    beforeAll(async () => {
        await getBinaryPath();
        dir = fs.mkdtempSync(join(os.tmpdir(), "diode-wsc-exit-"));
        vsix = join(dir, "tf-probe.vsix");
        await writeZip(vsix, {
            "extension/package.json": JSON.stringify({
                name: "tf-probe",
                publisher: "diode-test",
                version: "0.0.1",
                engines: { vscode: "^1.80.0" },
                activationEvents: ["workspaceContains:**/*.tf"],
                main: "./extension.js",
            }),
            "extension/extension.js": "exports.activate = () => {};\n",
        });
        pidFile = join(dir, "rg.pid");
        fakeRg = join(dir, "rg");
        fs.writeFileSync(
            fakeRg,
            [
                "#!/bin/sh",
                'case "$*" in',
                `  *'*.tf'*) echo $$ > '${pidFile}'; exec sleep 120 ;;`,
                "esac",
                "exit 0",
                "",
            ].join("\n"),
        );
        fs.chmodSync(fakeRg, 0o755);
    }, 300_000);

    afterAll(() => {
        if (fs.existsSync(pidFile)) {
            const pid = Number(fs.readFileSync(pidFile, "utf8"));
            if (isAlive(pid)) process.kill(pid, "SIGKILL");
        }
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("Quit returns at once and takes the hung rg down", { timeout: 120_000 }, async () => {
        const { session } = await useHeadlessApp({
            files: { "README.md": "# notes\n" },
            installVsix: [vsix],
            env: { DIODE_RIPGREP_PATH: fakeRg },
        });
        // No editor to wait for (only the folder is open): the rg start itself says the window is up — the
        // `workspaceContains` pass is the last startup step.
        const editorPid = session.pid;
        expect(editorPid).toBeDefined();
        await waitUntil(
            () => (fs.existsSync(pidFile) ? fs.readFileSync(pidFile, "utf8").trim() : ""),
            (pid) => pid !== "",
            { timeoutMs: 30_000, describe: "the workspaceContains rg starts" },
        );
        const rgPid = Number(fs.readFileSync(pidFile, "utf8"));
        expect(isAlive(rgPid)).toBe(true);

        const started = Date.now();
        // The reply may never come: the process is gone.
        void session.executeCommand("workbench.action.quit").catch(() => undefined);
        await waitUntil(
            () => editorPid !== undefined && isAlive(editorPid),
            (alive) => !alive,
            { timeoutMs: EXIT_BUDGET_MS, intervalMs: 50, describe: "the editor process exits" },
        );
        const exitMs = Date.now() - started;

        expect(exitMs).toBeLessThan(EXIT_BUDGET_MS);
        expect(isAlive(rgPid)).toBe(false);
    });
});
