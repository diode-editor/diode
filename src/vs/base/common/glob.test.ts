import { describe, expect, it } from "vitest";

import { globToRegExp, matchAnyGlob, matchGlob } from "./glob.ts";

describe("glob", () => {
    it("`*` не переходит через разделитель сегментов", () => {
        expect(matchGlob("src/*.ts", "src/main.ts")).toBe(true);
        expect(matchGlob("src/*.ts", "src/vs/main.ts")).toBe(false);
    });

    it("`**/` матчит ноль и более сегментов", () => {
        expect(matchGlob("**/settings.json", "settings.json")).toBe(true);
        expect(matchGlob("**/settings.json", "a/b/settings.json")).toBe(true);
        expect(matchGlob("**/settings.json", "a/settings.jsonc")).toBe(false);
    });

    it("`**` без разделителя матчит любой хвост", () => {
        expect(matchGlob("node_modules/**", "node_modules/pkg/index.js")).toBe(true);
        expect(matchGlob("node_modules/**", "node_modules")).toBe(false);
    });

    it("`?` — ровно один символ внутри сегмента", () => {
        expect(matchGlob("file?.ts", "file1.ts")).toBe(true);
        expect(matchGlob("file?.ts", "file12.ts")).toBe(false);
        expect(matchGlob("file?.ts", "file/.ts")).toBe(false);
    });

    it("`{a,b}` — альтернативы", () => {
        expect(matchGlob("**/*.{ts,js}", "src/main.ts")).toBe(true);
        expect(matchGlob("**/*.{ts,js}", "src/main.js")).toBe(true);
        expect(matchGlob("**/*.{ts,js}", "src/main.css")).toBe(false);
    });

    it("запятая вне группы — обычный символ", () => {
        expect(matchGlob("a,b.ts", "a,b.ts")).toBe(true);
        expect(matchGlob("a,b.ts", "a.ts")).toBe(false);
    });

    it("точка и прочая regexp-мета экранируются", () => {
        expect(matchGlob("a.ts", "axts")).toBe(false);
        expect(matchGlob("a+b.ts", "a+b.ts")).toBe(true);
        expect(matchGlob("(x).ts", "(x).ts")).toBe(true);
        expect(matchGlob("[0-9].ts", "[0-9].ts")).toBe(true);
        expect(matchGlob("[0-9].ts", "5.ts")).toBe(false);
    });

    it("непарная `}` матчится буквально", () => {
        expect(matchGlob("a}.ts", "a}.ts")).toBe(true);
    });

    it("шаблон якорится по всему пути", () => {
        expect(matchGlob("main.ts", "src/main.ts")).toBe(false);
    });

    it("компиляция кэшируется по шаблону", () => {
        expect(globToRegExp("**/*.ts")).toBe(globToRegExp("**/*.ts"));
    });

    it("matchAnyGlob: пустой набор не матчит ничего", () => {
        expect(matchAnyGlob([], "a.ts")).toBe(false);
        expect(matchAnyGlob(["**/*.js", "**/*.ts"], "a.ts")).toBe(true);
    });
});
