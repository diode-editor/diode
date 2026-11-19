import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { TerminalCell } from "@tuidom/core/common/iTerminalSurface";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ITerminalCommand } from "../../../../platform/terminal/common/capabilities/capabilities.ts";

import { EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

// Edges of the command model fed by the real injected scripts: what a user types and what an extension will read.

const BASH = "/bin/bash";
const ZSH = ["/usr/bin/zsh", "/bin/zsh"].find((p) => existsSync(p));
const WAIT = { timeout: 20_000, interval: 50 };
const EXECUTED = "\x1b]633;C\x07";

let home: string;
let tmp: string;
const sessions: EmbeddedTerminalSession[] = [];

beforeEach(() => {
    home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "diode-si-edge-home-")));
    tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "diode-si-edge-tmp-")));
});
afterEach(() => {
    for (const session of sessions.splice(0)) session.dispose();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

interface IRecorded {
    readonly session: EmbeddedTerminalSession;
    readonly executed: ITerminalCommand[];
    readonly finished: ITerminalCommand[];
    readonly output: Map<ITerminalCommand, string[]>;
    integrationOn: number;
}

function start(shell: string): IRecorded {
    const session = new EmbeddedTerminalSession({
        cols: 100,
        rows: 10,
        shell,
        cwd: home,
        env: { HOME: home, HISTFILE: "/dev/null", ZDOTDIR: home, skip_global_compinit: "1" },
        shellIntegrationEnabled: true,
    });
    sessions.push(session);
    const recorded: IRecorded = { session, executed: [], finished: [], output: new Map(), integrationOn: 0 };
    session.shellIntegration.capabilities.onDidAddCommandDetectionCapability((detection) => {
        recorded.integrationOn++;
        detection.onCommandExecuted((command) => recorded.executed.push(command));
        detection.onCommandFinished((command) => recorded.finished.push(command));
    });
    session.shellIntegration.onDidWriteCommandOutput(({ command, data }) => {
        const pieces = recorded.output.get(command) ?? [];
        pieces.push(data);
        recorded.output.set(command, pieces);
    });
    return recorded;
}

async function run(recorded: IRecorded, line: string): Promise<ITerminalCommand> {
    const before = recorded.finished.length;
    recorded.session.write(`${line}\r`);
    await vi.waitFor(() => {
        expect(recorded.finished.length).toBeGreaterThan(before);
    }, WAIT);
    return recorded.finished[before];
}

function screen(session: EmbeddedTerminalSession): string {
    const out: TerminalCell = { char: "", fg: 0, bg: 0, style: 0, width: 1 };
    let text = "";
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 100; x++) if (session.readCell(x, y, out)) text += out.char;
        text += "\n";
    }
    return text;
}

async function ready(shell: string): Promise<IRecorded> {
    const recorded = start(shell);
    await vi.waitFor(() => {
        expect(recorded.integrationOn).toBe(1);
    }, WAIT);
    return recorded;
}

function edges(shell: string) {
    it("a command line with `;`, `\\`, `=`, quotes and unicode reaches the model exactly", async () => {
        const recorded = await ready(shell);
        const line = `echo 'a;b' "c=d" x\\\\y γειά 東京 🙂 $'\\x41'`;
        const command = await run(recorded, line);
        expect([command.command, command.isTrusted, command.commandLineConfidence, command.exitCode]).toStrictEqual([
            line,
            true,
            "high",
            0,
        ]);
    }, 30_000);

    it("cd into a directory with spaces, `;`, `=`, `\\` and unicode: the model's cwd is that directory", async () => {
        const dir = path.join(tmp, "a b;c=d\\e ü 東京");
        mkdirSync(dir);
        const recorded = await ready(shell);
        await run(recorded, `cd '${dir}'`);
        const pwd = await run(recorded, "pwd");
        expect(pwd.cwd).toBe(dir);
        expect(recorded.session.shellIntegration.capabilities.get("cwdDetection")?.getCwd()).toBe(dir);
    }, 30_000);

    it("a megabyte of output arrives whole: starts with C, every byte once, no D", async () => {
        const recorded = await ready(shell);
        const size = 1024 * 1024;
        const started = Date.now();
        const command = await run(recorded, `head -c ${size} /dev/zero | tr '\\0' y; echo`);
        const elapsed = Date.now() - started;
        const pieces = recorded.output.get(command) ?? [];
        const all = pieces.join("");
        expect(all.startsWith(EXECUTED)).toBe(true);
        expect(all).not.toContain("\x1b]633;D");
        expect(all.split("y").length - 1).toBe(size);
        expect(elapsed).toBeLessThan(15_000);
    }, 60_000);

    it("Ctrl+C on a typed line at the prompt: the next command is clean", async () => {
        const recorded = await ready(shell);
        recorded.session.write("garbage text");
        await vi.waitFor(() => {
            expect(screen(recorded.session)).toContain("garbage text");
        }, WAIT);
        recorded.session.write("\x03");
        await vi.waitFor(() => {
            expect(
                screen(recorded.session)
                    .split("\n")
                    .filter((l) => l.trim() !== "")
                    .at(-1),
            ).not.toContain("garbage text");
        }, WAIT);
        const echo = await run(recorded, "echo ok");
        const last = recorded.finished.at(-1);
        expect([last?.command, last?.exitCode]).toStrictEqual(["echo ok", 0]);
        expect(echo.command).toBe("echo ok");
        expect((recorded.output.get(echo) ?? []).join("")).toContain("ok\r\n");
    }, 30_000);

    it("Ctrl+C on a running command: it finishes with 130", async () => {
        const recorded = await ready(shell);
        recorded.session.write("sleep 30\r");
        await vi.waitFor(() => {
            expect(recorded.executed.at(-1)?.command).toBe("sleep 30");
        }, WAIT);
        const before = recorded.finished.length;
        recorded.session.write("\x03");
        await vi.waitFor(() => {
            expect(recorded.finished.length).toBeGreaterThan(before);
        }, WAIT);
        const sleep = recorded.finished[before];
        expect([sleep.command, sleep.exitCode]).toStrictEqual(["sleep 30", 130]);
    }, 30_000);

    it("a child exit code and a command after a failing one", async () => {
        const recorded = await ready(shell);
        const seven = await run(recorded, "sh -c 'exit 7'");
        const ok = await run(recorded, "true");
        expect([seven.exitCode, ok.exitCode]).toStrictEqual([7, 0]);
        expect(recorded.executed.map((c) => c.command)).toStrictEqual(["sh -c 'exit 7'", "true"]);
    }, 30_000);
}

describe("EmbeddedTerminalSession — command model edges, bash", () => {
    edges(BASH);
});

describe.skipIf(ZSH === undefined)("EmbeddedTerminalSession — command model edges, zsh", () => {
    edges(ZSH ?? "");
});
