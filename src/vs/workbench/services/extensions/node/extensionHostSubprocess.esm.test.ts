import { describe, expect, it } from "vitest";

import { isEsmEntry } from "./extensionHostSubprocess.ts";

describe("isEsmEntry — правило эталона", () => {
    it(".mjs — всегда ESM, независимо от манифеста", () => {
        expect(isEsmEntry("/x/extension.mjs", undefined)).toBe(true);
        expect(isEsmEntry("/x/extension.mjs", "commonjs")).toBe(true);
    });

    it(".cjs — всегда CJS, даже у пакета с type=module", () => {
        expect(isEsmEntry("/x/extension.cjs", "module")).toBe(false);
    });

    it(".js решает `type` пакета", () => {
        expect(isEsmEntry("/x/extension.js", "module")).toBe(true);
        expect(isEsmEntry("/x/extension.js", "commonjs")).toBe(false);
        expect(isEsmEntry("/x/extension.js", undefined)).toBe(false);
    });
});
