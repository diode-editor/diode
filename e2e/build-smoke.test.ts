import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error — build scripts live in untyped .mjs (they must not depend on tsx/jiti).
import { renderStub, verifyOffset } from "../scripts/selfextract-format.mjs";
// @ts-expect-error — see above.
import { smokeTestBinary } from "../scripts/smoke-binary.mjs";

/**
 * #143: the self-test must fail on a binary that doesn't start — a segfault looked like
 * "spawn OK, exited with code null", and a broken diode-macos-x64 shipped in a release.
 * In e2e rather than unit tests: `scripts/` is outside the vitest include and the coverage ratchet.
 */
describe.skipIf(process.platform === "win32")("smokeTestBinary — build self-test", () => {
    let dir = "";

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "diode-smoke-"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    function fakeBinary(name: string, body: string): string {
        const path = join(dir, name);
        writeFileSync(path, `#!/bin/sh\n${body}\n`);
        chmodSync(path, 0o755);
        return path;
    }

    it("fails on a binary that crashes with SIGSEGV (regression #143)", () => {
        const binary = fakeBinary("segfault", "kill -SEGV $$");
        expect(() => smokeTestBinary(binary)).toThrow(/signal SIGSEGV/);
    });

    it("fails on a nonzero exit code", () => {
        const binary = fakeBinary("failing", 'echo "boom" >&2\nexit 3');
        expect(() => smokeTestBinary(binary)).toThrow(/exited with code 3/);
    });

    it("fails when the binary does not print a version", () => {
        const binary = fakeBinary("silent", "exit 0");
        expect(() => smokeTestBinary(binary)).toThrow(/no version/);
    });

    it("fails when the binary is missing or not executable", () => {
        expect(() => smokeTestBinary(join(dir, "missing"))).toThrow(/cannot be executed/);
    });

    it("passes and returns the version when the binary starts", () => {
        const binary = fakeBinary("working", 'echo "0.1.0-nightly"');
        expect(smokeTestBinary(binary)).toBe("0.1.0-nightly");
    });

    it("invokes the binary with exactly --version", () => {
        // The self-test must take a path that exits with code 0 on its own: without
        // arguments the real binary brings up an empty window and waits for a TTY.
        const binary = fakeBinary("cli", '[ "$1" = "--version" ] || { echo "no --version" >&2; exit 1; }\necho "1.2.3"');
        expect(smokeTestBinary(binary)).toBe("1.2.3");
    });

    /**
     * Regression for a macOS bug: BSD tail reads an offset with leading zeros as octal
     * and silently seeks to the wrong place, so tar gets the stub text instead of gzip.
     * The bug itself doesn't reproduce on Linux (GNU tail), so we test the build invariant
     * rather than tail's behavior: the number in the stub must have no leading zeros, and
     * gzip must start at OFFSET.
     */
    describe("stub and payload concatenation (#144)", () => {
        const STUB = '#!/bin/sh\nOFFSET=@@OFFSET@@\nexec echo hi\n';
        const GZIP = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);

        /** Assembles the file exactly the way build-selfextract does. */
        function writeSelfExtract(name: string, stub: string): string {
            const path = join(dir, name);
            writeFileSync(path, Buffer.concat([Buffer.from(stub, "utf8"), GZIP]));
            return path;
        }

        it("OFFSET points exactly at the first payload byte and has no leading zeros", () => {
            const stub = renderStub(STUB) as string;

            const offset = Number(/^OFFSET=(\d+)$/m.exec(stub)![1]);
            expect(offset).toBe(Buffer.byteLength(stub, "utf8") + 1);
            expect(stub).not.toMatch(/^OFFSET=0\d/m);

            // tail -c +N contract: 1-based, so byte `offset` is the start of the payload.
            expect(() => verifyOffset(writeSelfExtract("ok", stub), stub)).not.toThrow();
        });

        it("a leading zero in OFFSET is rejected (BSD tail would read it as octal)", () => {
            // This is exactly what the bug looked like: 0000003427 consists only of octal digits,
            // so BSD tail parses it silently and fully → 1815 instead of 3427.
            const stub = '#!/bin/sh\nOFFSET=0000003427\n';
            expect(() => verifyOffset(writeSelfExtract("octal", stub), stub)).toThrow(/leading zero/);
        });

        it("a desynced offset is rejected", () => {
            const stub = "#!/bin/sh\nOFFSET=99999\n";
            expect(() => verifyOffset(writeSelfExtract("desync", stub), stub)).toThrow(/gzip magic/);
        });
    });
});
