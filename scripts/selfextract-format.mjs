/**
 * Формат самораспаковывающегося файла:
 *
 *     [ #!/bin/sh стаб (selfextract-stub.sh) ][ payload.tar.gz ]
 *
 * Отдельно от `build-selfextract.mjs`, чтобы тест не тянул пайплайн сборки.
 * Без шебанга сознательно: vitest на Windows инлайнит файл через esbuild transform,
 * который шебанг НЕ срезает, — `#!` падает в ESM как SyntaxError.
 */

import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STUB_TEMPLATE_PATH = join(import.meta.dirname, "selfextract-stub.sh");

/**
 * @param {{ outputPath: string, payload: Buffer, key: string }} params
 */
export function writeSelfExtract({ outputPath, payload, key }) {
    const template = readFileSync(STUB_TEMPLATE_PATH, "utf8");
    if (!template.includes("@@OFFSET@@") || !template.includes("@@KEY@@")) {
        throw new Error("[selfextract] Stub is missing @@OFFSET@@ / @@KEY@@ placeholders");
    }

    const stub = renderStub(template.replace("@@KEY@@", key));
    mkdirSync(join(outputPath, ".."), { recursive: true });
    writeFileSync(outputPath, Buffer.concat([Buffer.from(stub, "utf8"), payload]));
    chmodSync(outputPath, 0o755);
    verifyOffset(outputPath, stub);
}

/**
 * Offset — длина самого стаба в байтах +1 (`tail -c +N` 1-based); подстановка меняет
 * длину, поэтому итерируем до неподвижной точки.
 *
 * Ведущие нули до фиксированной ширины НЕ годятся: BSD tail на macOS молча читает
 * `0000003427` как восьмеричное (1815), и tar получает текст стаба вместо gzip.
 *
 * @param {string} template Стаб со всеми плейсхолдерами кроме `@@OFFSET@@`.
 * @returns {string}
 */
export function renderStub(template) {
    let offset = Buffer.byteLength(template.replace("@@OFFSET@@", "0"), "utf8") + 1;
    for (let i = 0; i < 8; i++) {
        const stub = template.replace("@@OFFSET@@", String(offset));
        const actual = Buffer.byteLength(stub, "utf8") + 1;
        if (actual === offset) return stub;
        offset = actual;
    }
    throw new Error("[selfextract] Stub offset did not converge");
}

/**
 * Читаем записанный файл, а не буфер: при кросс-сборке самотест не запускается, и
 * ошибка в offset дожила бы до первого запуска пользователем.
 *
 * @param {string} outputPath
 * @param {string} stub Отрендеренный стаб — из него же берём OFFSET, как его увидит sh.
 */
export function verifyOffset(outputPath, stub) {
    const declared = /^OFFSET=(\d+)$/m.exec(stub);
    if (declared === null) throw new Error("[selfextract] Cannot find OFFSET= line in the rendered stub");
    if (declared[1].length > 1 && declared[1].startsWith("0")) {
        throw new Error(`[selfextract] OFFSET has a leading zero: ${declared[1]} (BSD tail would read it as octal)`);
    }

    const offset = Number(declared[1]);
    const fd = openSync(outputPath, "r");
    try {
        const magic = Buffer.alloc(2);
        readSync(fd, magic, 0, 2, offset - 1); // tail -c +N — 1-based
        if (magic[0] !== 0x1f || magic[1] !== 0x8b) {
            throw new Error(
                `[selfextract] No gzip magic at OFFSET=${String(offset)} (got ${magic.toString("hex")}) — ` +
                    `stub and payload are out of sync`,
            );
        }
    } finally {
        closeSync(fd);
    }
}
