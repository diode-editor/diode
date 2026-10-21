import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { isFileNotFound } from "./fsErrors.ts";

describe("isFileNotFound", () => {
    it("a real ENOENT from fs: yes", () => {
        const missing = path.join(os.tmpdir(), `diode-fs-errors-${String(process.pid)}-${String(Date.now())}`);
        let caught: unknown;
        try {
            fs.readFileSync(missing);
        } catch (err) {
            caught = err;
        }
        expect(isFileNotFound(caught)).toBe(true);
    });

    it("another fs code, an error without a code, a non-object and null: no", () => {
        expect(isFileNotFound(Object.assign(new Error("denied"), { code: "EACCES" }))).toBe(false);
        expect(isFileNotFound(new Error("plain"))).toBe(false);
        expect(isFileNotFound("ENOENT")).toBe(false);
        expect(isFileNotFound(null)).toBe(false);
        expect(isFileNotFound(undefined)).toBe(false);
    });
});
