import { describe, expect, it } from "vitest";

import { isEsmEntry } from "./extensionHostSubprocess.ts";

describe("isEsmEntry — upstream rule", () => {
    it(".mjs is always ESM, regardless of the manifest", () => {
        expect(isEsmEntry("/x/extension.mjs", undefined)).toBe(true);
        expect(isEsmEntry("/x/extension.mjs", "commonjs")).toBe(true);
    });

    it(".cjs is always CJS, even in a package with type=module", () => {
        expect(isEsmEntry("/x/extension.cjs", "module")).toBe(false);
    });

    it("package `type` decides for .js", () => {
        expect(isEsmEntry("/x/extension.js", "module")).toBe(true);
        expect(isEsmEntry("/x/extension.js", "commonjs")).toBe(false);
        expect(isEsmEntry("/x/extension.js", undefined)).toBe(false);
    });
});
