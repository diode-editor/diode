import { describe, expect, it } from "vitest";

import { LogLevel } from "../../log/common/logLevel.ts";

import { parseCliArgs } from "./cliArgs.ts";

describe("parseCliArgs — режимы позиционных", () => {
    it("parses -g / --goto as a mode flag, not a value flag", () => {
        expect(parseCliArgs(["-g", "a.ts:10:5"]).goto).toBe(true);
        expect(parseCliArgs(["--goto", "a.ts:10:5"]).goto).toBe(true);
        // Позиционный остаётся сырым — разбор file:line:col живёт в startupTargets.
        expect(parseCliArgs(["-g", "a.ts:10:5"]).positional).toEqual(["a.ts:10:5"]);
        expect(parseCliArgs([]).goto).toBe(false);
    });

    it("parses -d / --diff with exactly two files", () => {
        expect(parseCliArgs(["-d", "a.ts", "b.ts"]).diff).toBe(true);
        expect(parseCliArgs(["--diff", "a.ts", "b.ts"]).positional).toEqual(["a.ts", "b.ts"]);
        expect(parseCliArgs([]).diff).toBe(false);
    });

    it("throws when --diff does not get exactly two files", () => {
        expect(() => parseCliArgs(["-d", "a.ts"])).toThrow(/exactly two files, got 1/);
        expect(() => parseCliArgs(["-d"])).toThrow(/exactly two files, got 0/);
        expect(() => parseCliArgs(["-d", "a.ts", "b.ts", "c.ts"])).toThrow(/exactly two files, got 3/);
    });

    it("throws when --diff is combined with --goto", () => {
        expect(() => parseCliArgs(["-d", "-g", "a.ts", "b.ts"])).toThrow(/cannot be combined with --goto/);
    });
});

describe("parseCliArgs — расширения", () => {
    it("parses --extensions-dir with separate value and =form", () => {
        expect(parseCliArgs(["--extensions-dir", "/tmp/ext"]).extensionsDir).toBe("/tmp/ext");
        expect(parseCliArgs(["--extensions-dir=/tmp/ext"]).extensionsDir).toBe("/tmp/ext");
        expect(parseCliArgs([]).extensionsDir).toBeUndefined();
    });

    it("parses --disable-extensions", () => {
        expect(parseCliArgs(["--disable-extensions"]).disableExtensions).toBe(true);
        expect(parseCliArgs([]).disableExtensions).toBe(false);
    });
});

describe("parseCliArgs — уровни логирования", () => {
    it("parses a bare --log level as a wildcard rule", () => {
        expect(parseCliArgs(["--log", "debug"]).logLevels).toEqual([{ channel: "*", level: LogLevel.Debug }]);
        expect(parseCliArgs(["--log=warn"]).logLevels).toEqual([{ channel: "*", level: LogLevel.Warn }]);
    });

    it("parses a channel-scoped --log rule, splitting on the last colon", () => {
        expect(parseCliArgs(["--log", "extensions.host:trace"]).logLevels).toEqual([
            { channel: "extensions.host", level: LogLevel.Trace },
        ]);
        expect(parseCliArgs(["--log", "a:b:error"]).logLevels).toEqual([{ channel: "a:b", level: LogLevel.Error }]);
    });

    it("keeps repeated --log rules in command-line order", () => {
        expect(parseCliArgs(["--log", "warn", "--log", "extensions:trace"]).logLevels).toEqual([
            { channel: "*", level: LogLevel.Warn },
            { channel: "extensions", level: LogLevel.Trace },
        ]);
    });

    it("treats --verbose as --log trace and keeps its place in the order", () => {
        expect(parseCliArgs(["--verbose"]).logLevels).toEqual([{ channel: "*", level: LogLevel.Trace }]);
        expect(parseCliArgs(["--log", "error", "--verbose"]).logLevels).toEqual([
            { channel: "*", level: LogLevel.Error },
            { channel: "*", level: LogLevel.Trace },
        ]);
    });

    it("throws on an unknown, empty-channel or missing --log value", () => {
        expect(() => parseCliArgs(["--log", "dbug"])).toThrow(/off\|trace\|debug\|info\|warn\|error/);
        expect(() => parseCliArgs(["--log", ":info"])).toThrow(/non-empty channel/);
        expect(() => parseCliArgs(["--log"])).toThrow(/requires a value/);
    });

    it("defaults logLevels to empty", () => {
        expect(parseCliArgs([]).logLevels).toEqual([]);
    });
});
