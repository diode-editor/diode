import { describe, expect, it } from "vitest";

import { needsNoopOrganizeImports, ORGANIZE_IMPORTS_TS_KIND } from "./organizeImports.ts";

describe("diode-lsp-typescript — холостая Organize Imports", () => {
    it("сервер промолчал на запрос organize imports — нужна холостая", () => {
        expect(needsNoopOrganizeImports("source.organizeImports", [])).toBe(true);
        expect(needsNoopOrganizeImports("source", ["source.fixAll.ts"])).toBe(true);
        expect(needsNoopOrganizeImports(ORGANIZE_IMPORTS_TS_KIND, [undefined])).toBe(true);
        expect(needsNoopOrganizeImports("", [])).toBe(true);
    });

    it("сервер отдал organize imports — своё не добавляем", () => {
        expect(needsNoopOrganizeImports("source.organizeImports", [ORGANIZE_IMPORTS_TS_KIND])).toBe(false);
        expect(needsNoopOrganizeImports("source", ["source.fixAll.ts", "source.organizeImports"])).toBe(false);
    });

    it("запрос не про organize imports — как эталон, без действия", () => {
        expect(needsNoopOrganizeImports(undefined, [])).toBe(false);
        expect(needsNoopOrganizeImports("quickfix", [])).toBe(false);
        expect(needsNoopOrganizeImports("source.fixAll", [])).toBe(false);
        // Соседний подвид и вид с тем же префиксом без точки — не предки.
        expect(needsNoopOrganizeImports("source.organizeImports.biome", [])).toBe(false);
        expect(needsNoopOrganizeImports("source.organize", [])).toBe(false);
    });

    it("вид с тем же префиксом без точки — не organize imports", () => {
        expect(needsNoopOrganizeImports("source", ["source.organizeImportsX"])).toBe(true);
    });
});
