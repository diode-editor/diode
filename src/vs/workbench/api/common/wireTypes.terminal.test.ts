import { describe, expect, it } from "vitest";

import {
    parseWireTerminalActive,
    parseWireTerminalClosed,
    parseWireTerminalOpened,
    parseWireTerminalPtyDimensions,
    parseWireTerminalPtyInput,
} from "./wireTypes.ts";

describe("parseWireTerminalOpened", () => {
    it("без числового id или строкового имени — null", () => {
        expect(parseWireTerminalOpened(null)).toBeNull();
        expect(parseWireTerminalOpened({ id: "1", name: "a" })).toBeNull();
        expect(parseWireTerminalOpened({ id: 1, name: 2 })).toBeNull();
    });

    it("метка, pid и launch проходят; мусор в них отбрасывается", () => {
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
    it("closed: код — только число, незнакомая причина — unknown", () => {
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

    it("active: не число — активного нет", () => {
        expect(parseWireTerminalActive({ id: 4 })).toStrictEqual({ id: 4 });
        expect(parseWireTerminalActive({ id: "4" })).toStrictEqual({ id: null });
        expect(parseWireTerminalActive(null)).toStrictEqual({ id: null });
        expect(parseWireTerminalActive(undefined)).toStrictEqual({ id: null });
    });
});

describe("pty: start/resize/input", () => {
    it("размер — положительные целые, id — число", () => {
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

    it("ввод — строка", () => {
        expect(parseWireTerminalPtyInput({ id: 1, data: "x" })).toStrictEqual({ id: 1, data: "x" });
        expect(parseWireTerminalPtyInput({ id: 1, data: 1 })).toBeNull();
        expect(parseWireTerminalPtyInput({ data: "x" })).toBeNull();
        expect(parseWireTerminalPtyInput(undefined)).toBeNull();
    });
});
