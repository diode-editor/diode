import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
    parseShowEnvironment,
    queryTmuxClient,
    runTmux,
    tmuxPassesExtendedKeys,
    type TmuxRunner,
} from "./tmuxClientProbe.ts";

describe("parseShowEnvironment", () => {
    it.each<[string | undefined, string | undefined]>([
        ["LC_DIODE_PLATFORM=mac\n", "mac"],
        ["LC_DIODE_PLATFORM=\n", ""],
        ["-LC_DIODE_PLATFORM\n", undefined], // the variable is removed from the session environment
        ["unknown variable: LC_DIODE_PLATFORM", undefined],
        [undefined, undefined],
    ])("%j → %j", (output, expected) => {
        expect(parseShowEnvironment(output, "LC_DIODE_PLATFORM")).toBe(expected);
    });
});

describe("queryTmuxClient", () => {
    it("collects client_termtype and the client variables in one pass", async () => {
        const calls: string[] = [];
        const run: TmuxRunner = (args) => {
            calls.push(args.join(" "));
            if (args[0] === "display-message") return Promise.resolve("kitty(0.45.0)\tbpaste,extkeys,title\ton\n");
            if (args[1] === "LC_DIODE_PLATFORM") return Promise.resolve("LC_DIODE_PLATFORM=mac\n");
            return Promise.resolve("LC_TERMINAL=iTerm2\n");
        };
        await expect(queryTmuxClient(run)).resolves.toEqual({
            termType: "kitty(0.45.0)",
            envPlatform: "mac",
            lcTerminal: "iTerm2",
            extendedKeys: true,
        });
        expect(calls).toEqual([
            "display-message -p #{client_termtype}\t#{client_termfeatures}\t#{extended-keys}",
            "show-environment LC_DIODE_PLATFORM",
            "show-environment LC_TERMINAL",
        ]);
    });

    it("extended-keys off in the last field, before the newline, means no extended keys", async () => {
        const run: TmuxRunner = (args) =>
            Promise.resolve(args[0] === "display-message" ? "kitty(0.45.0)\textkeys\toff\n" : undefined);
        await expect(queryTmuxClient(run)).resolves.toMatchObject({ termType: "kitty(0.45.0)", extendedKeys: false });
    });

    it("an empty termtype and tmux failures mean `unknown`, without exceptions", async () => {
        const run: TmuxRunner = (args) => Promise.resolve(args[1] === "LC_TERMINAL" ? "  \n" : undefined);
        await expect(queryTmuxClient(run)).resolves.toEqual({
            termType: undefined,
            envPlatform: undefined,
            lcTerminal: undefined,
            extendedKeys: false,
        });
    });
});

describe("tmuxPassesExtendedKeys", () => {
    it.each<[string | undefined, string | undefined, boolean]>([
        ["on\n", "bpaste,extkeys,title\n", true],
        ["always\n", "extkeys", true],
        ["off\n", "bpaste,extkeys", false],
        ["on\n", "bpaste,title", false],
        ["on\n", "notextkeys,extkeys2", false],
        ["on\n", undefined, false],
        [undefined, "extkeys", false],
        ["", "extkeys", false], // tmux before 3.2 has no such option
    ])("extended-keys %j, termfeatures %j → %j", (option, features, expected) => {
        expect(tmuxPassesExtendedKeys(option, features)).toBe(expected);
    });
});

describe("runTmux", () => {
    it("returns tmux stdout", async () => {
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

    it("a missing tmux binary or server gives undefined, not an exception", async () => {
        const saved = process.env.PATH;
        process.env.PATH = "/nonexistent";
        try {
            await expect(runTmux(["display-message", "-p", "x"])).resolves.toBeUndefined();
        } finally {
            process.env.PATH = saved;
        }
    });
});
