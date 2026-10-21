import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";

// Each step is a separate CLI process; the session lives between them, as for an agent in Bash.
// Each scenario ends with zero processes carrying the session marker and zero temp directories.

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const cli = resolve(repoRoot, "tools", "drive", "cli.ts");
const session = `e2e-${String(process.pid)}`;

interface Run {
    code: number | null;
    stdout: string;
    stderr: string;
}

function drive(...args: string[]): Run {
    const result = spawnSync(process.execPath, ["--import", "tsx", cli, ...args, "-s", session], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 150_000,
    });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function ok(...args: string[]): string {
    const run = drive(...args);
    if (run.code !== 0) throw new Error(`drive ${args.join(" ")} → ${String(run.code)}\n${run.stdout}\n${run.stderr}`);
    return run.stdout;
}

/** Processes carrying the session marker (Linux; empty on other OSes, as in the tool itself). */
function markedPids(root: string): number[] {
    if (process.platform !== "linux") return [];
    const pids: number[] = [];
    for (const entry of readdirSync("/proc")) {
        if (!/^\d+$/.test(entry)) continue;
        try {
            if (readFileSync(`/proc/${entry}/environ`, "utf8").includes(`DIODE_DRIVE_SESSION=${session}:${root}\0`)) {
                pids.push(Number(entry));
            }
        } catch {
            // exited or not ours
        }
    }
    return pids;
}

describe.skipIf(process.platform === "win32")("npm run drive — live run of the binary", () => {
    let binary: string;

    beforeAll(async () => {
        binary = await getBinaryPath();
    }, 180_000);

    afterAll(() => {
        drive("stop");
    });

    it("start → palette → exec → output/context/when → screen → stop: nothing is left behind", () => {
        const started = JSON.parse(
            ok(
                "start",
                "--binary-path",
                binary,
                "--size",
                "120x30",
                "--file",
                "notes.txt=alpha\\nbeta\\n",
                "--open",
                "notes.txt",
                "--json",
            ),
        ) as { ready: boolean; root: string; pid: number; workspaceDir: string };
        expect(started.ready).toBe(true);
        expect(markedPids(started.root)).toContain(started.pid);

        // Readiness: a repeated call answers immediately.
        ok("wait", "ready", "--timeout", "5000");
        ok("wait", "text", "alpha");
        expect(ok("focus")).toMatch(/EditorElement\n$/);

        // Command palette by title: the panel opened.
        ok("palette", "View: Toggle Panel Visibility");
        ok("wait", "text", "PROBLEMS");

        // A command by id changes the frame; the promise result comes back.
        expect(ok("exec", "workbench.action.closeActiveEditor").trim()).toBe("ok");
        ok("wait", "gone", "EditorElement");

        // OUTPUT: channels and content (startup itself writes the inspector port line).
        expect(ok("output", "--list")).toContain("bootstrap\tBootstrap");
        expect(ok("output", "Bootstrap")).toContain("TUIDom inspector listening");

        // Context keys and when.
        const panel = JSON.parse(ok("context", "activeOutputChannel", "--json")) as { value: unknown };
        expect(typeof panel.value).toBe("string");
        expect(ok("when", "!inQuickOpen").trim()).toBe("true");

        // Typing: reopen the file via quick open and type char by char.
        ok("key", "Ctrl+P");
        ok("wait", "node", "#quickInput");
        ok("type", "notes");
        ok("key", "Enter");
        ok("wait", "focus", "EditorElement");
        ok("type", "X");
        ok("wait", "text", "Xalpha");

        // Cell and cursor: the cursor is right after the typed X.
        const cursor = ok("cursor").trim();
        expect(cursor).toMatch(/^\d+,\d+$/);
        const [cx, cy] = cursor.split(",");
        expect(ok("cell", String(Number(cx) - 1), cy)).toMatch(/"X" U\+0058 fg=(#[0-9a-f]{6}|default)/);

        // Errors come with a clear message and a nonzero code.
        const unknown = drive("exec", "no.such.command");
        expect(unknown.code).toBe(1);
        expect(unknown.stderr).toContain("unknown command: no.such.command");
        const badKey = drive("key", "Down");
        expect(badKey.code).toBe(1);
        expect(badKey.stderr).toContain("ArrowDown");

        const stopped = ok("stop");
        expect(stopped).toContain("stopped gracefully");
        expect(markedPids(started.root)).toEqual([]);
        expect(existsSync(started.root)).toBe(false);
        expect(drive("screen").code).toBe(3);
    }, 240_000);

    it.skipIf(process.platform !== "linux")("gc after a killed session: descendants are killed, root and record are removed", () => {
        const started = JSON.parse(ok("start", "--binary-path", binary, "--json")) as { root: string; pid: number };
        const before = markedPids(started.root);
        // At least the editor itself + the extension subprocess.
        expect(before.length).toBeGreaterThan(1);

        process.kill(started.pid, "SIGKILL");
        const list = ok("list");
        expect(list).toContain("DEAD");
        expect(drive("screen").code).toBe(3);

        expect(ok("gc")).toMatch(/dead sessions removed: 1/);
        expect(markedPids(started.root)).toEqual([]);
        expect(existsSync(started.root)).toBe(false);
        expect(ok("list").trim()).not.toContain(session);
    }, 240_000);
});
