import { describe, expect, it } from "vitest";

import {
    parseWireTerminalCreate,
    parseWireTerminalSendText,
    parseWireTerminalShow,
    parseWireTerminalTarget,
} from "./hostWireParsers.ts";

describe("parseWireTerminalCreate", () => {
    it("без числовой метки — null", () => {
        expect(parseWireTerminalCreate(null)).toBeNull();
        expect(parseWireTerminalCreate("x")).toBeNull();
        expect(parseWireTerminalCreate({ extHostId: "1" })).toBeNull();
        expect(parseWireTerminalCreate({ extHostId: Number.NaN })).toBeNull();
    });

    it("полный набор опций проходит как есть", () => {
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

    it("пустые строки и не-true флаги — «не задано»; мусорные типы отбрасываются", () => {
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

describe("адрес терминала в show/hide/dispose/sendText", () => {
    it("хостовый id побеждает метку; без обоих — null", () => {
        expect(parseWireTerminalTarget({ terminal: { id: 2, extHostId: 9 } })).toStrictEqual({ terminal: { id: 2 } });
        expect(parseWireTerminalTarget({ terminal: { extHostId: 9 } })).toStrictEqual({ terminal: { extHostId: 9 } });
        expect(parseWireTerminalTarget({ terminal: { id: "2" } })).toBeNull();
        expect(parseWireTerminalTarget({ terminal: null })).toBeNull();
        expect(parseWireTerminalTarget({})).toBeNull();
        expect(parseWireTerminalTarget(undefined)).toBeNull();
    });

    it("show: preserveFocus — только явное true", () => {
        expect(parseWireTerminalShow({ terminal: { id: 1 }, preserveFocus: true })).toStrictEqual({
            terminal: { id: 1 },
            preserveFocus: true,
        });
        expect(parseWireTerminalShow({ terminal: { id: 1 }, preserveFocus: "true" })?.preserveFocus).toBe(false);
        expect(parseWireTerminalShow({ terminal: {} })).toBeNull();
    });

    it("sendText: текст обязателен; Enter отключает только явное false", () => {
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
