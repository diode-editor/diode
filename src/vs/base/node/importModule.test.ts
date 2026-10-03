import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { importModule } from "./importModule.ts";

// Загрузка с ФС, которая обязана работать и под SEA: один и тот же приём нужен
// `runAsNode` (language-серверы) и ESM-расширениям extension host'а. Под SEA
// проверить это юнитом нельзя — там гейтом идёт e2e на собранном бинаре; здесь
// закрываем сам контракт: ESM (в т.ч. с top-level await) и CJS одинаково.

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
    it("грузит ESM-модуль и отдаёт его namespace", async () => {
        const file = write("esm.mjs", "export const marker = 'esm';\nexport default 7;\n");
        const mod = (await importModule(file)) as { marker: string; default: number };
        expect(mod.marker).toBe("esm");
        expect(mod.default).toBe(7);
    });

    it("берёт ESM с top-level await (на нём ломается require(esm))", async () => {
        const file = write("tla.mjs", "await Promise.resolve();\nexport const marker = 'tla';\n");
        const mod = (await importModule(file)) as { marker: string };
        expect(mod.marker).toBe("tla");
    });

    it("грузит CJS-модуль — exports доступны как `default`", async () => {
        const file = write("cjs.cjs", "module.exports = { marker: 'cjs' };\n");
        const mod = (await importModule(file)) as { default: { marker: string } };
        expect(mod.default.marker).toBe("cjs");
    });

    it("относительный require внутри модуля резолвится от его каталога", async () => {
        write("dep.cjs", "module.exports = { from: 'dep' };\n");
        const file = write("host.cjs", "module.exports = require('./dep.cjs');\n");
        const mod = (await importModule(file)) as { default: { from: string } };
        expect(mod.default.from).toBe("dep");
    });

    it("ошибка загрузки доезжает до вызывающего отказом промиса", async () => {
        const file = write("broken.mjs", "throw new Error('boom from module');\n");
        await expect(importModule(file)).rejects.toThrow("boom from module");
    });
});
