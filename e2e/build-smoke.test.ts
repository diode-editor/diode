import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error — build-скрипты живут в .mjs без типов (они не должны зависеть от tsx/jiti).
import { renderStub, verifyOffset } from "../scripts/selfextract-format.mjs";
// @ts-expect-error — см. выше.
import { smokeTestBinary } from "../scripts/smoke-binary.mjs";

/**
 * Регресс на первопричину #143: самотест сборки обязан ПАДАТЬ на бинаре, который
 * не стартует. Прошлая версия проверки смотрела только на `error` от spawnSync,
 * поэтому segfault выглядел как «spawn OK, exited with code null», и битый
 * diode-macos-x64 уехал в релиз.
 *
 * Живёт в e2e, а не в юнитах: `scripts/` не входит ни в один vitest-include, и
 * втягивать его в unit-конфиг = втягивать в храповик 100% покрытия. Сборка бинаря
 * тесту не нужна — «бинари» здесь это sh-скрипты, поэтому тест быстрый.
 */
describe.skipIf(process.platform === "win32")("smokeTestBinary — самотест сборки", () => {
    let dir = "";

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "diode-smoke-"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    /** Кладёт исполняемый sh-скрипт, притворяющийся собранным бинарём. */
    function fakeBinary(name: string, body: string): string {
        const path = join(dir, name);
        writeFileSync(path, `#!/bin/sh\n${body}\n`);
        chmodSync(path, 0o755);
        return path;
    }

    it("падает на бинаре, который крашится по SIGSEGV (регресс #143)", () => {
        const binary = fakeBinary("segfault", "kill -SEGV $$");
        expect(() => smokeTestBinary(binary)).toThrow(/signal SIGSEGV/);
    });

    it("падает на ненулевом коде возврата", () => {
        const binary = fakeBinary("failing", 'echo "boom" >&2\nexit 3');
        expect(() => smokeTestBinary(binary)).toThrow(/exited with code 3/);
    });

    it("падает, когда бинарь не печатает версию", () => {
        const binary = fakeBinary("silent", "exit 0");
        expect(() => smokeTestBinary(binary)).toThrow(/no version/);
    });

    it("падает, когда бинаря нет или он неисполним", () => {
        expect(() => smokeTestBinary(join(dir, "missing"))).toThrow(/cannot be executed/);
    });

    it("проходит и возвращает версию, когда бинарь стартует", () => {
        const binary = fakeBinary("working", 'echo "0.1.0-nightly"');
        expect(smokeTestBinary(binary)).toBe("0.1.0-nightly");
    });

    it("зовёт бинарь именно с --version (пустые аргументы дают exit 1 «Usage»)", () => {
        // Точная причина, по которой прошлый самотест не мог отличить краш от нормы.
        const binary = fakeBinary("cli", '[ "$1" = "--version" ] || { echo "Usage: diode <file>" >&2; exit 1; }\necho "1.2.3"');
        expect(smokeTestBinary(binary)).toBe("1.2.3");
    });

    /**
     * Регресс на macOS-баг: offset с ведущими нулями BSD tail читает как восьмеричное
     * и молча отматывает не туда, из-за чего tar получает текст стаба вместо gzip.
     * На Linux (GNU tail) сам баг не воспроизводится, поэтому тестируем инвариант
     * сборки, а не поведение tail: число в стабе обязано быть без ведущих нулей, а по
     * OFFSET обязан лежать gzip.
     */
    describe("склейка стаба и payload (#144)", () => {
        const STUB = '#!/bin/sh\nOFFSET=@@OFFSET@@\nexec echo hi\n';
        const GZIP = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);

        /** Собирает файл ровно так, как это делает build-selfextract. */
        function writeSelfExtract(name: string, stub: string): string {
            const path = join(dir, name);
            writeFileSync(path, Buffer.concat([Buffer.from(stub, "utf8"), GZIP]));
            return path;
        }

        it("OFFSET указывает ровно на первый байт payload и не имеет ведущих нулей", () => {
            const stub = renderStub(STUB) as string;

            const offset = Number(/^OFFSET=(\d+)$/m.exec(stub)![1]);
            expect(offset).toBe(Buffer.byteLength(stub, "utf8") + 1);
            expect(stub).not.toMatch(/^OFFSET=0\d/m);

            // Контракт tail -c +N: 1-based, поэтому байт offset — начало payload.
            expect(() => verifyOffset(writeSelfExtract("ok", stub), stub)).not.toThrow();
        });

        it("ведущий ноль в OFFSET отвергается (BSD tail прочитал бы его как octal)", () => {
            // Именно так выглядел баг: 0000003427 состоит только из восьмеричных цифр,
            // поэтому BSD tail парсит его молча и целиком → 1815 вместо 3427.
            const stub = '#!/bin/sh\nOFFSET=0000003427\n';
            expect(() => verifyOffset(writeSelfExtract("octal", stub), stub)).toThrow(/leading zero/);
        });

        it("разъехавшийся offset отвергается", () => {
            const stub = "#!/bin/sh\nOFFSET=99999\n";
            expect(() => verifyOffset(writeSelfExtract("desync", stub), stub)).toThrow(/gzip magic/);
        });
    });
});
