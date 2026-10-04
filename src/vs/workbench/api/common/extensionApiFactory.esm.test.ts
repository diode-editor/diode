import { describe, expect, it } from "vitest";

import { buildVscodeEsmShim } from "./extensionApiFactory.ts";

// Генерация виртуального ESM-модуля `"vscode"`. Что ESM-расширение реально
// получает своё API, закрывает `extensionHost.extensionIdentity.test.ts` в
// настоящем субпроцессе.

const KEY = Symbol.for("diode.vscodeApi");

describe("buildVscodeEsmShim", () => {
    it("по именованному export'у на член namespace'а; без id — общий API", () => {
        const source = buildVscodeEsmShim(["window", "workspace"]);
        expect(source).toContain('const ns = globalThis[Symbol.for("diode.vscodeApi")]();');
        expect(source).toContain('export const window = ns["window"];');
        expect(source).toContain('export const workspace = ns["workspace"];');
        // По объявлению на строку: шим читается в отладчике и стектрейсах.
        expect(source.split("\n")).toEqual([
            'const ns = globalThis[Symbol.for("diode.vscodeApi")]();',
            'export const window = ns["window"];',
            'export const workspace = ns["workspace"];',
        ]);
    });

    it("с id — API этого расширения (id экранирован как JS-строка)", () => {
        const source = buildVscodeEsmShim(["window"], 'pub."ext"');
        expect(source).toContain('const ns = globalThis[Symbol.for("diode.vscodeApi")]("pub.\\"ext\\"");');
    });

    it("имена, которые не являются идентификаторами, в модуль не попадают", () => {
        const source = buildVscodeEsmShim(["ok", "not-an-ident", "2bad", "", "default", "$ok_1"]);
        expect(source).toContain('export const ok = ns["ok"];');
        expect(source).toContain('export const $ok_1 = ns["$ok_1"];');
        expect(source).not.toContain("not-an-ident");
        expect(source).not.toContain("2bad");
        expect(source).not.toContain('ns[""]');
        expect(source).not.toContain("export const default");
    });

    it("сгенерированный модуль — валидный ESM и берёт API нужного расширения", async () => {
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
