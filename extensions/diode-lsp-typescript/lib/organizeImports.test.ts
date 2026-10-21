import { describe, expect, it } from "vitest";

import { needsNoopOrganizeImports, ORGANIZE_IMPORTS_TS_KIND } from "./organizeImports.ts";

describe("diode-lsp-typescript — no-op Organize Imports", () => {
    it("server returned nothing for an organize imports request — no-op is needed", () => {
        expect(needsNoopOrganizeImports("source.organizeImports", [])).toBe(true);
        expect(needsNoopOrganizeImports("source", ["source.fixAll.ts"])).toBe(true);
        expect(needsNoopOrganizeImports(ORGANIZE_IMPORTS_TS_KIND, [undefined])).toBe(true);
        expect(needsNoopOrganizeImports("", [])).toBe(true);
    });

    it("server returned organize imports — nothing of ours is added", () => {
        expect(needsNoopOrganizeImports("source.organizeImports", [ORGANIZE_IMPORTS_TS_KIND])).toBe(false);
        expect(needsNoopOrganizeImports("source", ["source.fixAll.ts", "source.organizeImports"])).toBe(false);
    });

    it("request is not about organize imports — like upstream, no action", () => {
        expect(needsNoopOrganizeImports(undefined, [])).toBe(false);
        expect(needsNoopOrganizeImports("quickfix", [])).toBe(false);
        expect(needsNoopOrganizeImports("source.fixAll", [])).toBe(false);
        // A sibling subkind and a kind with the same prefix without a dot are not ancestors.
        expect(needsNoopOrganizeImports("source.organizeImports.biome", [])).toBe(false);
        expect(needsNoopOrganizeImports("source.organize", [])).toBe(false);
    });

    it("kind with the same prefix without a dot is not organize imports", () => {
        expect(needsNoopOrganizeImports("source", ["source.organizeImportsX"])).toBe(true);
    });
});
