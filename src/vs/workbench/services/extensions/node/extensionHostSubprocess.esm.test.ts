import { describe, expect, it } from "vitest";

import { buildVscodeEsmShim, isEsmEntry } from "./extensionHostSubprocess.ts";

// Правило выбора loader'а и генерация виртуального ESM-модуля `"vscode"`.
// Обе функции чистые, поэтому проверяются здесь; что ESM-расширение реально
// активируется, закрывает `extensionHost.esmExtension.test.ts` (он поднимает
// субпроцесс БЕЗ tsx — иначе `import … from "vscode"` уходит в CJS-резолвер
// tsx и маскирует отсутствие хука).

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

describe("buildVscodeEsmShim", () => {
    it("по именованному export'у на член namespace'а", () => {
        const source = buildVscodeEsmShim(["window", "workspace"]);
        expect(source).toContain('const ns = globalThis[Symbol.for("diode.vscodeApi")];');
        expect(source).toContain('export const window = ns["window"];');
        expect(source).toContain('export const workspace = ns["workspace"];');
    });

    it("имена, которые не являются идентификаторами, в модуль не попадают", () => {
        const source = buildVscodeEsmShim(["ok", "not-an-ident", "2bad", "", "default"]);
        expect(source).toContain('export const ok = ns["ok"];');
        expect(source).not.toContain("not-an-ident");
        expect(source).not.toContain("2bad");
        expect(source).not.toContain("export const default");
    });

    it("сгенерированный модуль — валидный ESM", async () => {
        const marker = { value: 42 };
        (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("diode.vscodeApi")] = { probe: marker };
        try {
            const source = buildVscodeEsmShim(["probe"]);
            const url = `data:text/javascript,${encodeURIComponent(source)}`;
            const mod = (await import(url)) as { probe: unknown };
            expect(mod.probe).toBe(marker);
        } finally {
            Reflect.deleteProperty(globalThis as unknown as Record<symbol, unknown>, Symbol.for("diode.vscodeApi"));
        }
    });
});
