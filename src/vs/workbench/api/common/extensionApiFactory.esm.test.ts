import { describe, expect, it } from "vitest";

import { buildVscodeEsmShim } from "./extensionApiFactory.ts";

// That an ESM extension really gets its own API is covered by
// `extensionHost.extensionIdentity.test.ts` in a real subprocess.

const KEY = Symbol.for("diode.vscodeApi");

describe("buildVscodeEsmShim", () => {
    it("one named export per namespace member; without id — the shared API", () => {
        const source = buildVscodeEsmShim(["window", "workspace"]);
        expect(source).toContain('const ns = globalThis[Symbol.for("diode.vscodeApi")]();');
        expect(source).toContain('export const window = ns["window"];');
        expect(source).toContain('export const workspace = ns["workspace"];');
        // One declaration per line: the shim is readable in the debugger and stack traces.
        expect(source.split("\n")).toEqual([
            'const ns = globalThis[Symbol.for("diode.vscodeApi")]();',
            'export const window = ns["window"];',
            'export const workspace = ns["workspace"];',
        ]);
    });

    it("with id — the API of that extension (id escaped as a JS string)", () => {
        const source = buildVscodeEsmShim(["window"], 'pub."ext"');
        expect(source).toContain('const ns = globalThis[Symbol.for("diode.vscodeApi")]("pub.\\"ext\\"");');
    });

    it("names that are not identifiers are left out of the module", () => {
        const source = buildVscodeEsmShim(["ok", "not-an-ident", "2bad", "", "default", "$ok_1"]);
        expect(source).toContain('export const ok = ns["ok"];');
        expect(source).toContain('export const $ok_1 = ns["$ok_1"];');
        expect(source).not.toContain("not-an-ident");
        expect(source).not.toContain("2bad");
        expect(source).not.toContain('ns[""]');
        expect(source).not.toContain("export const default");
    });

    it("the generated module is valid ESM and takes the API of the right extension", async () => {
        const marker = { value: 42 };
        const asked: (string | undefined)[] = [];
        (globalThis as unknown as Record<symbol, unknown>)[KEY] = (id?: string) => {
            asked.push(id);
            return { probe: marker };
        };
        try {
            const source = buildVscodeEsmShim(["probe"], "pub.esm");
            const url = `data:text/javascript,${encodeURIComponent(source)}`;
            const mod = (await import(url)) as { probe: unknown };
            expect(mod.probe).toBe(marker);
            expect(asked).toEqual(["pub.esm"]);
        } finally {
            Reflect.deleteProperty(globalThis as unknown as Record<symbol, unknown>, KEY);
        }
    });
});
