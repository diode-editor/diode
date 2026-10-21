import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { importModule } from "./importModule.ts";

// Under SEA only e2e on the built binary checks this; here it is the contract: ESM (with top-level await) and CJS alike.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-import-module-"));

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(name: string, source: string): string {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, source);
    return file;
}

describe("importModule", () => {
    it("loads an ESM module and returns its namespace", async () => {
        const file = write("esm.mjs", "export const marker = 'esm';\nexport default 7;\n");
        const mod = (await importModule(file)) as { marker: string; default: number };
        expect(mod.marker).toBe("esm");
        expect(mod.default).toBe(7);
    });

    it("handles ESM with top-level await (require(esm) breaks on it)", async () => {
        const file = write("tla.mjs", "await Promise.resolve();\nexport const marker = 'tla';\n");
        const mod = (await importModule(file)) as { marker: string };
        expect(mod.marker).toBe("tla");
    });

    it("loads a CJS module; exports are available as `default`", async () => {
        const file = write("cjs.cjs", "module.exports = { marker: 'cjs' };\n");
        const mod = (await importModule(file)) as { default: { marker: string } };
        expect(mod.default.marker).toBe("cjs");
    });

    it("a relative require inside the module resolves from its directory", async () => {
        write("dep.cjs", "module.exports = { from: 'dep' };\n");
        const file = write("host.cjs", "module.exports = require('./dep.cjs');\n");
        const mod = (await importModule(file)) as { default: { from: string } };
        expect(mod.default.from).toBe("dep");
    });

    it("a load error reaches the caller as a rejected promise", async () => {
        const file = write("broken.mjs", "throw new Error('boom from module');\n");
        await expect(importModule(file)).rejects.toThrow("boom from module");
    });
});
