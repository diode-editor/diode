/**
 * Self-extracting file format:
 *
 *     [ #!/bin/sh stub (selfextract-stub.sh) ][ payload.tar.gz ]
 *
 * Separate from `build-selfextract.mjs` so the test does not pull in the build pipeline.
 * No shebang on purpose: vitest on Windows inlines the file via an esbuild transform
 * that does NOT strip the shebang, and `#!` fails in ESM as a SyntaxError.
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
 * The offset is the stub's own length in bytes +1 (`tail -c +N` is 1-based); substitution
 * changes the length, so iterate to a fixed point.
 *
 * Zero padding to a fixed width does NOT work: BSD tail on macOS silently reads
 * `0000003427` as octal (1815), and tar gets the stub text instead of gzip.
 *
 * @param {string} template The stub with all placeholders filled except `@@OFFSET@@`.
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
 * Reads the written file, not the buffer: a cross build skips the self-test, and an
 * offset bug would survive until the user's first launch.
 *
 * @param {string} outputPath
 * @param {string} stub The rendered stub; OFFSET is taken from it, as sh will see it.
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
        readSync(fd, magic, 0, 2, offset - 1); // tail -c +N is 1-based
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
