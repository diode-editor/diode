import { describe, expect, it } from "vitest";

import { flag, flagAll, intFlag, parseArgs, parseFileSpec, parseSize, UsageError } from "./args.ts";

describe("parseArgs", () => {
    it("command, positionals, flags anywhere", () => {
        const args = parseArgs(["click", "--node", "#a", "3", "-s", "x", "4", "--json"]);
        expect(args.command).toBe("click");
        expect(args.positionals).toEqual(["3", "4"]);
        expect(flag(args, "node")).toBe("#a");
        expect(flag(args, "session")).toBe("x");
        expect(args.booleans.has("json")).toBe(true);
    });

    it("--name=value and a repeated flag accumulate, the last value wins", () => {
        const args = parseArgs(["start", "--open=a.ts", "--open", "b.ts", "--size=80x24"]);
        expect(flagAll(args, "open")).toEqual(["a.ts", "b.ts"]);
        expect(flag(args, "open")).toBe("b.ts");
        expect(flag(args, "size")).toBe("80x24");
        expect(flagAll(args, "install")).toEqual([]);
        expect(flag(args, "install")).toBeUndefined();
    });

    it("after -- everything is positional, including text with a dash; a lone - is positional too", () => {
        const args = parseArgs(["type", "--", "--not-a-flag", "-s"]);
        expect(args.positionals).toEqual(["--not-a-flag", "-s"]);
        expect(parseArgs(["paste", "-"]).positionals).toEqual(["-"]);
    });

    it("empty line has no command", () => {
        expect(parseArgs([]).command).toBeUndefined();
    });

    it("unknown flag, boolean with a value, flag without a value are errors", () => {
        expect(() => parseArgs(["x", "--nope"])).toThrow(new UsageError("unknown flag --nope"));
        expect(() => parseArgs(["x", "-q"])).toThrow("unknown flag -q");
        expect(() => parseArgs(["x", "--json=1"])).toThrow("flag --json takes no value");
        expect(() => parseArgs(["x", "--node"])).toThrow("flag --node requires a value");
    });

    it("intFlag", () => {
        expect(intFlag(parseArgs(["x", "--timeout", "500"]), "timeout")).toBe(500);
        expect(intFlag(parseArgs(["x"]), "timeout")).toBeUndefined();
        expect(() => intFlag(parseArgs(["x", "--timeout", "5s"]), "timeout")).toThrow(
            "--timeout: expected a non-negative integer",
        );
        expect(() => intFlag(parseArgs(["x", "--timeout", "-1"]), "timeout")).toThrow("expected");
    });
});

describe("parseSize", () => {
    it("cols x rows", () => {
        expect(parseSize("140x38")).toEqual({ cols: 140, rows: 38 });
    });
    it("malformed and zero size are errors", () => {
        expect(() => parseSize("140*38")).toThrow("<cols>x<rows>");
        expect(() => parseSize("0x38")).toThrow("positive");
        expect(() => parseSize("10x0")).toThrow("positive");
    });
});

describe("parseFileSpec", () => {
    it("path=content, \\n is a newline, = in the content is kept", () => {
        expect(parseFileSpec("src/a.ts=const a = 1;\\nlet b")).toEqual(["src/a.ts", "const a = 1;\nlet b"]);
    });
    it("missing path is an error", () => {
        expect(() => parseFileSpec("=x")).toThrow("<path>=<content>");
        expect(() => parseFileSpec("abc")).toThrow("<path>=<content>");
    });
});
