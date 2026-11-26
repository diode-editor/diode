import { describe, expect, it } from "vitest";

import {
    parseWireTerminalActive,
    parseWireTerminalClosed,
    parseWireTerminalInteraction,
    parseWireTerminalOpened,
    parseWireTerminalPtyDimensions,
    parseWireTerminalPtyInput,
    parseWireTerminalShellExecutionData,
    parseWireTerminalShellExecutionEnd,
    parseWireTerminalShellExecutionStart,
    parseWireTerminalShellIntegration,
    parseWireTerminalShellIntegrationCwd,
    parseWireTerminalShellIntegrationEnv,
    parseWireTerminalTitleChanged,
} from "./terminalWireParsers.ts";

describe("parseWireTerminalTitleChanged / parseWireTerminalInteraction", () => {
    it("need a numeric id (and a string name); anything else is null", () => {
        expect(parseWireTerminalTitleChanged(null)).toBeNull();
        expect(parseWireTerminalTitleChanged({ id: "1", name: "a" })).toBeNull();
        expect(parseWireTerminalTitleChanged({ id: 1, name: 2 })).toBeNull();
        expect(parseWireTerminalTitleChanged({ id: 1, name: "a", extra: 1 })).toStrictEqual({ id: 1, name: "a" });
        expect(parseWireTerminalInteraction(null)).toBeNull();
        expect(parseWireTerminalInteraction({ id: "1" })).toBeNull();
        expect(parseWireTerminalInteraction({ id: 1, extra: 1 })).toStrictEqual({ id: 1 });
    });
});

describe("parseWireTerminalOpened", () => {
    it("without a numeric id or string name: null", () => {
        expect(parseWireTerminalOpened(null)).toBeNull();
        expect(parseWireTerminalOpened({ id: "1", name: "a" })).toBeNull();
        expect(parseWireTerminalOpened({ id: 1, name: 2 })).toBeNull();
    });

    it("label, pid and launch pass; garbage in them is dropped", () => {
        expect(
            parseWireTerminalOpened({
                id: 1,
                extHostId: 2,
                name: "a",
                pid: 3,
                launch: {
                    name: "a",
                    shellPath: "/bin/sh",
                    shellArgs: ["-i", 4],
                    cwd: "/w",
                    env: { A: "1", B: null, C: 1 },
                    hideFromUser: false,
                },
            }),
        ).toStrictEqual({
            id: 1,
            extHostId: 2,
            name: "a",
            pid: 3,
            launch: {
                name: "a",
                shellPath: "/bin/sh",
                shellArgs: ["-i"],
                cwd: "/w",
                env: { A: "1", B: null },
                hideFromUser: false,
            },
        });
        expect(
            parseWireTerminalOpened({
                id: 1,
                extHostId: "2",
                name: "a",
                pid: "3",
                launch: { name: 1, shellPath: 2, shellArgs: "x", cwd: 3, env: null, hideFromUser: "no" },
            }),
        ).toStrictEqual({ id: 1, name: "a", launch: {} });
        expect(parseWireTerminalOpened({ id: 1, name: "a", launch: "x" })).toStrictEqual({
            id: 1,
            name: "a",
            launch: {},
        });
        expect(parseWireTerminalOpened({ id: 1, name: "a", launch: null })).toStrictEqual({
            id: 1,
            name: "a",
            launch: {},
        });
        expect(parseWireTerminalOpened({ id: 1, name: "a" })).toStrictEqual({ id: 1, name: "a", launch: {} });
    });
});

describe("parseWireTerminalClosed / parseWireTerminalActive", () => {
    it("closed: code is number-only, an unknown reason becomes unknown", () => {
        expect(parseWireTerminalClosed({ id: 1, code: 2, reason: "user" })).toStrictEqual({
            id: 1,
            code: 2,
            reason: "user",
        });
        expect(parseWireTerminalClosed({ id: 1, code: "2", reason: "boom" })).toStrictEqual({
            id: 1,
            reason: "unknown",
        });
        expect(parseWireTerminalClosed({ code: 2 })).toBeNull();
        expect(parseWireTerminalClosed(7)).toBeNull();
        expect(parseWireTerminalClosed(null)).toBeNull();
    });

    it("active: a non-number means no active terminal", () => {
        expect(parseWireTerminalActive({ id: 4 })).toStrictEqual({ id: 4 });
        expect(parseWireTerminalActive({ id: "4" })).toStrictEqual({ id: null });
        expect(parseWireTerminalActive(null)).toStrictEqual({ id: null });
        expect(parseWireTerminalActive(undefined)).toStrictEqual({ id: null });
    });
});

describe("pty: start/resize/input", () => {
    it("size is positive integers, id is a number", () => {
        expect(parseWireTerminalPtyDimensions({ id: 1, cols: 80, rows: 24 })).toStrictEqual({
            id: 1,
            cols: 80,
            rows: 24,
        });
        expect(parseWireTerminalPtyDimensions({ id: "1", cols: 80, rows: 24 })).toBeNull();
        expect(parseWireTerminalPtyDimensions({ id: 1, cols: 0, rows: 24 })).toBeNull();
        expect(parseWireTerminalPtyDimensions({ id: 1, cols: 80, rows: 2.5 })).toBeNull();
        expect(parseWireTerminalPtyDimensions({ id: 1, cols: "80", rows: 24 })).toBeNull();
        expect(parseWireTerminalPtyDimensions(null)).toBeNull();
    });

    it("input is a string", () => {
        expect(parseWireTerminalPtyInput({ id: 1, data: "x" })).toStrictEqual({ id: 1, data: "x" });
        expect(parseWireTerminalPtyInput({ id: 1, data: 1 })).toBeNull();
        expect(parseWireTerminalPtyInput({ data: "x" })).toBeNull();
        expect(parseWireTerminalPtyInput(undefined)).toBeNull();
    });
});

describe("shell integration messages", () => {
    const line = { value: "ls", confidence: 2, isTrusted: true };

    it("changed, cwd and data need a numeric id and their typed field", () => {
        expect(parseWireTerminalShellIntegration({ id: 1, supportsExecuteCommand: false, x: 1 })).toStrictEqual({
            id: 1,
            supportsExecuteCommand: false,
        });
        expect(parseWireTerminalShellIntegration(null)).toBeNull();
        expect(parseWireTerminalShellIntegration({ id: "1", supportsExecuteCommand: true })).toBeNull();
        expect(parseWireTerminalShellIntegration({ id: 1, supportsExecuteCommand: "yes" })).toBeNull();
        expect(parseWireTerminalShellIntegrationCwd({ id: 1, cwd: "" })).toStrictEqual({ id: 1, cwd: "" });
        expect(parseWireTerminalShellIntegrationCwd(null)).toBeNull();
        expect(parseWireTerminalShellIntegrationCwd({ id: "1", cwd: "/" })).toBeNull();
        expect(parseWireTerminalShellIntegrationCwd({ id: 1, cwd: 1 })).toBeNull();
        expect(parseWireTerminalShellExecutionData({ id: 1, data: "x" })).toStrictEqual({ id: 1, data: "x" });
        expect(parseWireTerminalShellExecutionData(null)).toBeNull();
        expect(parseWireTerminalShellExecutionData({ id: "1", data: "x" })).toBeNull();
        expect(parseWireTerminalShellExecutionData({ id: 1, data: 1 })).toBeNull();
    });

    it("env keeps string values only; needs an object and a boolean trust", () => {
        expect(
            parseWireTerminalShellIntegrationEnv({ id: 1, env: { A: "1", B: 2, C: null }, isTrusted: false }),
        ).toStrictEqual({
            id: 1,
            env: { A: "1" },
            isTrusted: false,
        });
        expect(parseWireTerminalShellIntegrationEnv(null)).toBeNull();
        expect(parseWireTerminalShellIntegrationEnv({ id: "1", env: {}, isTrusted: true })).toBeNull();
        expect(parseWireTerminalShellIntegrationEnv({ id: 1, env: "A=1", isTrusted: true })).toBeNull();
        expect(parseWireTerminalShellIntegrationEnv({ id: 1, env: null, isTrusted: true })).toBeNull();
        expect(parseWireTerminalShellIntegrationEnv({ id: 1, env: {}, isTrusted: 1 })).toBeNull();
    });

    it("start: command line, confidence (unknown is Low), optional cwd", () => {
        expect(
            parseWireTerminalShellExecutionStart({ id: 1, supportsExecuteCommand: true, commandLine: line, cwd: "/w" }),
        ).toStrictEqual({
            id: 1,
            supportsExecuteCommand: true,
            commandLine: line,
            cwd: "/w",
        });
        for (const confidence of [0, 1, 2]) {
            expect(
                parseWireTerminalShellExecutionStart({
                    id: 1,
                    supportsExecuteCommand: false,
                    commandLine: { ...line, confidence },
                    cwd: 3,
                })?.commandLine.confidence,
            ).toBe(confidence);
        }
        expect(
            parseWireTerminalShellExecutionStart({
                id: 1,
                supportsExecuteCommand: true,
                commandLine: { ...line, confidence: 7 },
            }),
        ).toStrictEqual({ id: 1, supportsExecuteCommand: true, commandLine: { ...line, confidence: 0 } });
        expect(parseWireTerminalShellExecutionStart(null)).toBeNull();
        expect(
            parseWireTerminalShellExecutionStart({ id: "1", supportsExecuteCommand: true, commandLine: line }),
        ).toBeNull();
        expect(
            parseWireTerminalShellExecutionStart({ id: 1, supportsExecuteCommand: 1, commandLine: line }),
        ).toBeNull();
        expect(parseWireTerminalShellExecutionStart({ id: 1, supportsExecuteCommand: true })).toBeNull();
        expect(
            parseWireTerminalShellExecutionStart({
                id: 1,
                supportsExecuteCommand: true,
                commandLine: { ...line, value: 1 },
            }),
        ).toBeNull();
        expect(
            parseWireTerminalShellExecutionStart({
                id: 1,
                supportsExecuteCommand: true,
                commandLine: { ...line, isTrusted: "y" },
            }),
        ).toBeNull();
    });

    it("end: command line and a numeric exit code only", () => {
        expect(parseWireTerminalShellExecutionEnd({ id: 1, commandLine: line, exitCode: 0 })).toStrictEqual({
            id: 1,
            commandLine: line,
            exitCode: 0,
        });
        expect(parseWireTerminalShellExecutionEnd({ id: 1, commandLine: line, exitCode: "0" })).toStrictEqual({
            id: 1,
            commandLine: line,
        });
        expect(parseWireTerminalShellExecutionEnd(null)).toBeNull();
        expect(parseWireTerminalShellExecutionEnd({ id: "1", commandLine: line })).toBeNull();
        expect(parseWireTerminalShellExecutionEnd({ id: 1 })).toBeNull();
    });
});
