import { describe, expect, it } from "vitest";

import { flag, flagAll, intFlag, parseArgs, parseFileSpec, parseSize, UsageError } from "./args.ts";

describe("parseArgs", () => {
    it("команда, позиционные, флаги в любом месте", () => {
        const args = parseArgs(["click", "--node", "#a", "3", "-s", "x", "4", "--json"]);
        expect(args.command).toBe("click");
        expect(args.positionals).toEqual(["3", "4"]);
        expect(flag(args, "node")).toBe("#a");
        expect(flag(args, "session")).toBe("x");
        expect(args.booleans.has("json")).toBe(true);
    });

    it("--name=value и повтор флага копится, последнее значение побеждает", () => {
        const args = parseArgs(["start", "--open=a.ts", "--open", "b.ts", "--size=80x24"]);
        expect(flagAll(args, "open")).toEqual(["a.ts", "b.ts"]);
        expect(flag(args, "open")).toBe("b.ts");
        expect(flag(args, "size")).toBe("80x24");
        expect(flagAll(args, "install")).toEqual([]);
        expect(flag(args, "install")).toBeUndefined();
    });

    it("после -- всё позиционное, в т.ч. текст с дефисом; одиночный - — тоже позиционный", () => {
        const args = parseArgs(["type", "--", "--not-a-flag", "-s"]);
        expect(args.positionals).toEqual(["--not-a-flag", "-s"]);
        expect(parseArgs(["paste", "-"]).positionals).toEqual(["-"]);
    });

    it("пустая строка — без команды", () => {
        expect(parseArgs([]).command).toBeUndefined();
    });

    it("неизвестный флаг, булев со значением, флаг без значения — ошибки", () => {
        expect(() => parseArgs(["x", "--nope"])).toThrow(new UsageError("неизвестный флаг --nope"));
        expect(() => parseArgs(["x", "-q"])).toThrow("неизвестный флаг -q");
        expect(() => parseArgs(["x", "--json=1"])).toThrow("флаг --json не принимает значения");
        expect(() => parseArgs(["x", "--node"])).toThrow("флагу --node нужно значение");
    });

    it("intFlag", () => {
        expect(intFlag(parseArgs(["x", "--timeout", "500"]), "timeout")).toBe(500);
        expect(intFlag(parseArgs(["x"]), "timeout")).toBeUndefined();
        expect(() => intFlag(parseArgs(["x", "--timeout", "5s"]), "timeout")).toThrow(
            "--timeout: ожидалось неотрицательное целое",
        );
        expect(() => intFlag(parseArgs(["x", "--timeout", "-1"]), "timeout")).toThrow("ожидалось");
    });
});

describe("parseSize", () => {
    it("cols x rows", () => {
        expect(parseSize("140x38")).toEqual({ cols: 140, rows: 38 });
    });
    it("битый и нулевой размер — ошибки", () => {
        expect(() => parseSize("140*38")).toThrow("<cols>x<rows>");
        expect(() => parseSize("0x38")).toThrow("положительным");
        expect(() => parseSize("10x0")).toThrow("положительным");
    });
});

describe("parseFileSpec", () => {
    it("путь=содержимое, \\n — перевод строки, = в содержимом сохраняется", () => {
        expect(parseFileSpec("src/a.ts=const a = 1;\\nlet b")).toEqual(["src/a.ts", "const a = 1;\nlet b"]);
    });
    it("без пути — ошибка", () => {
        expect(() => parseFileSpec("=x")).toThrow("<путь>=<содержимое>");
        expect(() => parseFileSpec("abc")).toThrow("<путь>=<содержимое>");
    });
});
