import { describe, expect, it } from "vitest";

import {
    parseWireTerminalCreate,
    parseWireTerminalPtyData,
    parseWireTerminalPtyExit,
    parseWireTerminalSendText,
    parseWireTerminalShow,
    parseWireTerminalTarget,
} from "./hostWireParsers.ts";

describe("parseWireTerminalCreate", () => {
    it("only a tag: nothing extra", () => {
        expect(parseWireTerminalCreate({ extHostId: 1 })).toStrictEqual({ extHostId: 1 });
    });

    it("location: TerminalLocation as a number, a column, a parent; garbage means `unset`", () => {
        const loc = (location: unknown) => parseWireTerminalCreate({ extHostId: 1, location })?.location;
        expect(loc(1)).toBe(1);
        expect(loc(2)).toBe(2);
        expect(loc({ viewColumn: -2 })).toStrictEqual({ viewColumn: -2 });
        expect(loc({ viewColumn: 3, preserveFocus: true })).toStrictEqual({ viewColumn: 3, preserveFocus: true });
        expect(loc({ viewColumn: 3, preserveFocus: "yes" })).toStrictEqual({ viewColumn: 3 });
        expect(loc({ parentTerminal: { id: 4 } })).toStrictEqual({ parentTerminal: { id: 4 } });
        expect(loc({ parentTerminal: { extHostId: 5 } })).toStrictEqual({ parentTerminal: { extHostId: 5 } });
        for (const junk of [undefined, 0, 3, "2", null, {}, { viewColumn: "1" }, { parentTerminal: {} }]) {
            expect(parseWireTerminalCreate({ extHostId: 1, location: junk })).toStrictEqual({ extHostId: 1 });
        }
        expect(parseWireTerminalCreate({ extHostId: 1, pty: true, location: { viewColumn: -2 } })).toStrictEqual({
            extHostId: 1,
            pty: true,
            location: { viewColumn: -2 },
        });
    });

    it("no numeric tag gives null", () => {
        expect(parseWireTerminalCreate(null)).toBeNull();
        expect(parseWireTerminalCreate("x")).toBeNull();
        expect(parseWireTerminalCreate({ extHostId: "1" })).toBeNull();
        expect(parseWireTerminalCreate({ extHostId: Number.NaN })).toBeNull();
    });

    it("a full set of options passes as is", () => {
        expect(
            parseWireTerminalCreate({
                extHostId: 3,
                name: "n",
                shellPath: "/bin/sh",
                shellArgs: ["-c", 1, "x"],
                cwd: "/w",
                env: { A: "1", B: null, C: 2 },
                strictEnv: true,
                hideFromUser: true,
                message: "",
            }),
        ).toStrictEqual({
            extHostId: 3,
            name: "n",
            shellPath: "/bin/sh",
            shellArgs: ["-c", "x"],
            cwd: "/w",
            env: { A: "1", B: null },
            strictEnv: true,
            hideFromUser: true,
            message: "",
        });
    });

    it("empty strings and non-true flags mean `unset`; garbage types are dropped", () => {
        expect(
            parseWireTerminalCreate({
                extHostId: 1,
                name: "",
                shellPath: "",
                cwd: "",
                shellArgs: "a b",
                env: "A=1",
                strictEnv: "yes",
                hideFromUser: 1,
                message: 5,
            }),
        ).toStrictEqual({ extHostId: 1 });
    });
});

describe("parseWireTerminalCreate — pty", () => {
    it("pty: only tag and name, shell options are dropped", () => {
        expect(
            parseWireTerminalCreate({ extHostId: 2, pty: true, name: "log", shellPath: "/bin/sh", env: { A: "1" } }),
        ).toStrictEqual({ extHostId: 2, pty: true, name: "log" });
        expect(parseWireTerminalCreate({ extHostId: 2, pty: true })).toStrictEqual({ extHostId: 2, pty: true });
        expect(parseWireTerminalCreate({ extHostId: 2, pty: true, name: "" })).toStrictEqual({
            extHostId: 2,
            pty: true,
        });
        expect(parseWireTerminalCreate({ extHostId: 2, pty: "yes", name: "x" })).toStrictEqual({
            extHostId: 2,
            name: "x",
        });
    });
});

describe("terminal address in show/hide/dispose/sendText", () => {
    it("the host id beats the tag; without both gives null", () => {
        expect(parseWireTerminalTarget({ terminal: { id: 2, extHostId: 9 } })).toStrictEqual({ terminal: { id: 2 } });
        expect(parseWireTerminalTarget({ terminal: { extHostId: 9 } })).toStrictEqual({ terminal: { extHostId: 9 } });
        expect(parseWireTerminalTarget({ terminal: { id: "2" } })).toBeNull();
        expect(parseWireTerminalTarget({ terminal: null })).toBeNull();
        expect(parseWireTerminalTarget({})).toBeNull();
        expect(parseWireTerminalTarget(undefined)).toBeNull();
    });

    it("show: preserveFocus only on an explicit true", () => {
        expect(parseWireTerminalShow({ terminal: { id: 1 }, preserveFocus: true })).toStrictEqual({
            terminal: { id: 1 },
            preserveFocus: true,
        });
        expect(parseWireTerminalShow({ terminal: { id: 1 }, preserveFocus: "true" })?.preserveFocus).toBe(false);
        expect(parseWireTerminalShow({ terminal: {} })).toBeNull();
    });

    it("sendText: text is required; only an explicit false disables Enter", () => {
        expect(parseWireTerminalSendText({ terminal: { id: 1 }, text: "ls" })).toStrictEqual({
            terminal: { id: 1 },
            text: "ls",
            shouldExecute: true,
        });
        expect(
            parseWireTerminalSendText({ terminal: { id: 1 }, text: "ls", shouldExecute: false })?.shouldExecute,
        ).toBe(false);
        expect(parseWireTerminalSendText({ terminal: { id: 1 }, text: "ls", shouldExecute: 0 })?.shouldExecute).toBe(
            true,
        );
        expect(parseWireTerminalSendText({ terminal: { id: 1 }, text: 1 })).toBeNull();
        expect(parseWireTerminalSendText({ text: "ls" })).toBeNull();
    });
});

describe("pty: data/exit", () => {
    it("data is a string by address", () => {
        expect(parseWireTerminalPtyData({ terminal: { extHostId: 1 }, data: "x" })).toStrictEqual({
            terminal: { extHostId: 1 },
            data: "x",
        });
        expect(parseWireTerminalPtyData({ terminal: { extHostId: 1 }, data: 1 })).toBeNull();
        expect(parseWireTerminalPtyData({ data: "x" })).toBeNull();
    });

    it("exit: the code is a number only", () => {
        expect(parseWireTerminalPtyExit({ terminal: { id: 1 }, code: 2 })).toStrictEqual({
            terminal: { id: 1 },
            code: 2,
        });
        expect(parseWireTerminalPtyExit({ terminal: { id: 1 }, code: "2" })).toStrictEqual({ terminal: { id: 1 } });
        expect(parseWireTerminalPtyExit({ code: 2 })).toBeNull();
    });
});
