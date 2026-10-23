import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { IProcessSnapshot } from "./restartProcess.ts";
import { selfSpawnArgs, spawnSelfAsRole } from "./selfSpawnArgs.ts";

function snapshot(overrides: Partial<IProcessSnapshot> = {}): IProcessSnapshot {
    return {
        execPath: "/usr/bin/node",
        execArgv: ["--import", "tsx"],
        argv: ["/usr/bin/node", "/repo/src/vs/diode/main.ts", "file.ts"],
        isSea: false,
        env: {},
        ...overrides,
    };
}

describe("selfSpawnArgs", () => {
    it("dev: node + execArgv + main script (loaders must reach the child)", () => {
        expect(selfSpawnArgs(snapshot())).toEqual({
            command: "/usr/bin/node",
            args: ["--import", "tsx", "/repo/src/vs/diode/main.ts"],
        });
    });

    it("dev: user arguments are not passed to the child; it has its own role", () => {
        expect(selfSpawnArgs(snapshot()).args).not.toContain("file.ts");
    });

    it("SEA: the binary itself without arguments; it has no main script", () => {
        expect(
            selfSpawnArgs(snapshot({ execPath: "/opt/diode", isSea: true, argv: ["/opt/diode", "file.ts"] })),
        ).toEqual({ command: "/opt/diode", args: [] });
    });

    it("dev without a main script: an explicit error, not a silent launch of the wrong thing", () => {
        expect(() => selfSpawnArgs(snapshot({ argv: ["/usr/bin/node"] }))).toThrow(/cannot determine main script/);
    });

    it("an empty string instead of the main script: the same error", () => {
        expect(() => selfSpawnArgs(snapshot({ argv: ["/usr/bin/node", ""] }))).toThrow(/cannot determine main script/);
    });

    it("without an argument the snapshot is taken from the current process", () => {
        expect(selfSpawnArgs().command).toBe(process.execPath);
    });
});

describe("spawnSelfAsRole", () => {
    /** Stub child: sends over IPC the role flag, a value from env and whether its stdout is open. */
    const probe = `process.send({ role: process.env.DIODE_FILE_WATCHER, inherited: process.env.DIODE_PROBE, stdout: process.stdout.isTTY === undefined && process.stdout.writable }, () => process.exit(0));`;
    const spec = { command: process.execPath, args: ["-e", probe] };

    it("role flag in env on top of the given environment, IPC channel, stdout closed by default", async () => {
        const child = spawnSelfAsRole("DIODE_FILE_WATCHER", {
            stderr: "ignore",
            spec,
            env: { DIODE_PROBE: "yes", PATH: process.env.PATH },
        });
        const message = await new Promise((resolve) => child.once("message", resolve));

        expect(message).toMatchObject({ role: "1", inherited: "yes" });
        expect(child.stdout).toBeNull();
        expect(child.stderr).toBeNull();
        await new Promise((resolve) => child.once("exit", resolve));
    });

    it("stdout and stderr are streams when asked to be read; env defaults to process.env", async () => {
        const child = spawnSelfAsRole("DIODE_FILE_WATCHER", { stdout: "pipe", stderr: "pipe", spec });
        const message = await new Promise((resolve) => child.once("message", resolve));

        expect(message).toMatchObject({ role: "1" });
        expect(child.stdout).not.toBeNull();
        expect(child.stderr).not.toBeNull();
        await new Promise((resolve) => child.once("exit", resolve));
    });

    /**
     * A `Map` tells the wire format apart: JSON (the default, which the tests above run on) flattens it
     * to `{}`, the structured clone keeps it. One child, like the tests above: two at once starved on the
     * 2-vCPU Stryker dry run.
     */
    it("IPC serialization: the structured clone on request, and Node tells the child about it", async () => {
        const child = spawnSelfAsRole("DIODE_FILE_WATCHER", {
            stderr: "ignore",
            spec: {
                command: process.execPath,
                args: ["-e", `process.send({ map: new Map([["k", 1]]) }, () => process.exit(0));`],
            },
            serialization: "advanced",
        });
        const message = await new Promise((resolve) => child.once("message", resolve));

        expect(message).toEqual({ map: new Map([["k", 1]]) });
        await new Promise((resolve) => child.once("exit", resolve));
    });

    /** `/proc/self/stat` fields are read after the last `)`: `comm` may contain spaces and parentheses. */
    const groupProbe = [
        'const fs = require("node:fs");',
        'const stat = fs.readFileSync("/proc/self/stat", "utf-8");',
        'const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");',
        "process.send({ pid: process.pid, pgrp: Number(fields[2]) }, () => process.exit(0));",
    ].join("\n");

    async function spawnAndReportGroup(ownProcessGroup?: boolean): Promise<{ pid: number; pgrp: number }> {
        const child = spawnSelfAsRole("DIODE_FILE_WATCHER", {
            stderr: "ignore",
            spec: { command: process.execPath, args: ["-e", groupProbe] },
            ...(ownProcessGroup !== undefined ? { ownProcessGroup } : {}),
        });
        const message = await new Promise<{ pid: number; pgrp: number }>((resolve) => {
            child.once("message", (raw) => {
                resolve(raw as { pid: number; pgrp: number });
            });
        });
        await new Promise((resolve) => child.once("exit", resolve));
        return message;
    }

    it.skipIf(process.platform === "win32")("ownProcessGroup: the child leads its own process group", async () => {
        const { pid, pgrp } = await spawnAndReportGroup(true);

        expect(pgrp).toBe(pid);
    });

    it.skipIf(process.platform === "win32")(
        "without ownProcessGroup the child stays in the parent's group; the role does not get one silently",
        async () => {
            const { pid, pgrp } = await spawnAndReportGroup();

            expect(pgrp).not.toBe(pid);
            expect(pgrp).toBe(ownGroup());
        },
    );
});

function ownGroup(): number {
    const stat = readFileSync("/proc/self/stat", "utf-8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return Number(fields[2]);
}
