import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseShowEnvironment, queryTmuxClient, runTmux, type TmuxRunner } from "./tmuxClientProbe.ts";

describe("parseShowEnvironment", () => {
    it.each<[string | undefined, string | undefined]>([
        ["LC_DIODE_PLATFORM=mac\n", "mac"],
        ["LC_DIODE_PLATFORM=\n", ""],
        ["-LC_DIODE_PLATFORM\n", undefined], // переменная удалена из окружения сессии
        ["unknown variable: LC_DIODE_PLATFORM", undefined],
        [undefined, undefined],
    ])("%j → %j", (output, expected) => {
        expect(parseShowEnvironment(output, "LC_DIODE_PLATFORM")).toBe(expected);
    });
});

describe("queryTmuxClient", () => {
    it("собирает client_termtype и переменные клиента одним заходом", async () => {
        const calls: string[] = [];
        const run: TmuxRunner = (args) => {
            calls.push(args.join(" "));
            if (args[0] === "display-message") return Promise.resolve("kitty(0.45.0)\n");
            if (args[1] === "LC_DIODE_PLATFORM") return Promise.resolve("LC_DIODE_PLATFORM=mac\n");
            return Promise.resolve("-LC_TERMINAL\n");
        };
        await expect(queryTmuxClient(run)).resolves.toEqual({
            termType: "kitty(0.45.0)",
            envPlatform: "mac",
            lcTerminal: undefined,
        });
        expect(calls).toEqual([
            "display-message -p #{client_termtype}",
            "show-environment LC_DIODE_PLATFORM",
            "show-environment LC_TERMINAL",
        ]);
    });

    it("пустой termtype и сбои tmux — «не знаю», без исключений", async () => {
        const run: TmuxRunner = (args) => Promise.resolve(args[0] === "display-message" ? "  \n" : undefined);
        await expect(queryTmuxClient(run)).resolves.toEqual({
            termType: undefined,
            envPlatform: undefined,
            lcTerminal: undefined,
        });
    });
});

describe("runTmux", () => {
    it("отдаёт stdout tmux", async () => {
        const dir = mkdtempSync(join(tmpdir(), "fake-tmux-"));
        writeFileSync(join(dir, "tmux"), '#!/bin/sh\necho "args:$*"\n', { mode: 0o755 });
        const saved = process.env.PATH;
        process.env.PATH = dir;
        try {
            await expect(runTmux(["display-message", "-p", "x"])).resolves.toBe("args:display-message -p x\n");
        } finally {
            process.env.PATH = saved;
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("отсутствующий бинарь или сервер tmux — undefined, а не исключение", async () => {
        const saved = process.env.PATH;
        process.env.PATH = "/nonexistent";
        try {
            await expect(runTmux(["display-message", "-p", "x"])).resolves.toBeUndefined();
        } finally {
            process.env.PATH = saved;
        }
    });
});
