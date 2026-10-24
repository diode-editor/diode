import { realpathSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";

import { EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

// Relative paths in terminal links resolve against this cwd.
describe("EmbeddedTerminalSession.getCwd", () => {
    let ws: ITempWorkspace;
    let session: EmbeddedTerminalSession | undefined;

    afterEach(() => {
        session?.dispose();
        session = undefined;
        ws.dispose();
    });

    it.runIf(process.platform === "linux")("follows `cd` in the shell through /proc", async () => {
        ws = createTempWorkspace({ prefix: "diode-cwd-", files: { "sub/x.txt": "" } });
        const root = realpathSync(ws.dir);
        session = new EmbeddedTerminalSession({ cols: 40, rows: 5, shell: "/bin/sh", cwd: ws.dir });
        const live = session;
        await vi.waitFor(async () => {
            expect(await live.getCwd()).toBe(root);
        });
        live.write("cd sub\r");
        await vi.waitFor(
            async () => {
                expect(await live.getCwd()).toBe(`${root}/sub`);
            },
            { timeout: 5000, interval: 50 },
        );
    });

    it("without the process in /proc — the cwd the process started in", async () => {
        ws = createTempWorkspace({ prefix: "diode-cwd-" });
        session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 5,
            shell: "/bin/sh",
            args: ["-c", "exit 0"],
            cwd: ws.dir,
        });
        const live = session;
        await new Promise<void>((resolve) =>
            live.onExit(() => {
                resolve();
            }),
        );
        // The exited process is reaped: /proc/<pid> is gone.
        await vi.waitFor(async () => {
            expect(await live.getCwd()).toBe(ws.dir);
        });
    });
});
