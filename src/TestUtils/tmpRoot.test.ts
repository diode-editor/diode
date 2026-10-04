import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRunTmpRoot, pruneStaleRoots, setup } from "./tmpRoot.ts";

describe("tmpRoot — корень временных каталогов прогона", () => {
    let parent: string;

    beforeEach(() => {
        parent = fs.mkdtempSync(path.join(os.tmpdir(), "tmproot-case-"));
    });

    afterEach(() => {
        fs.rmSync(parent, { recursive: true, force: true });
    });

    /** Корень с явно заданным владельцем — как его оставил бы другой прогон. */
    function rootOwnedBy(pid: number): string {
        return createRunTmpRoot(parent, pid);
    }

    describe("createRunTmpRoot", () => {
        it("создаёт каталог в родителе и помечает владельцем", () => {
            const root = createRunTmpRoot(parent, 1234);

            expect(path.dirname(root)).toBe(parent);
            expect(fs.readFileSync(path.join(root, "owner.pid"), "utf-8")).toBe("1234");
        });

        it("два корня не конфликтуют", () => {
            expect(createRunTmpRoot(parent)).not.toBe(createRunTmpRoot(parent));
        });
    });

    describe("pruneStaleRoots", () => {
        it("сносит корень мёртвого владельца и не трогает живого", () => {
            const dead = rootOwnedBy(1111);
            const alive = rootOwnedBy(2222);
            fs.writeFileSync(path.join(dead, "forgotten.txt"), "мусор");

            const removed = pruneStaleRoots(parent, (pid) => pid === 2222);

            expect(removed).toEqual([dead]);
            expect(fs.existsSync(dead)).toBe(false);
            expect(fs.existsSync(alive)).toBe(true);
        });

        it("корень без метки владельца считается бесхозным", () => {
            const unmarked = fs.mkdtempSync(path.join(parent, "diode-testrun-"));

            expect(pruneStaleRoots(parent, () => true)).toEqual([unmarked]);
        });

        it("битая метка владельца — тоже бесхозный", () => {
            const broken = rootOwnedBy(42);
            fs.writeFileSync(path.join(broken, "owner.pid"), "не число", "utf-8");

            expect(pruneStaleRoots(parent, () => true)).toEqual([broken]);
        });

        it("не наш префикс не трогаем даже без метки", () => {
            // `diode-tests-*` принадлежит createTestEnvironment, `foo` — вообще не нам.
            const foreign = fs.mkdtempSync(path.join(parent, "diode-tests-"));
            const alien = fs.mkdtempSync(path.join(parent, "foo-"));

            expect(pruneStaleRoots(parent, () => false)).toEqual([]);
            expect(fs.existsSync(foreign)).toBe(true);
            expect(fs.existsSync(alien)).toBe(true);
        });

        it("файл с нашим префиксом — не каталог, пропускаем", () => {
            const file = path.join(parent, "diode-testrun-notadir");
            fs.writeFileSync(file, "");

            expect(pruneStaleRoots(parent, () => false)).toEqual([]);
            expect(fs.existsSync(file)).toBe(true);
        });

        it("нет родителя — пустой результат, без исключения", () => {
            expect(pruneStaleRoots(path.join(parent, "нет-такого"), () => false)).toEqual([]);
        });

        it.skipIf(process.platform === "win32")("корень, который не снести, не попадает в снесённые", () => {
            const stubborn = rootOwnedBy(1111);
            // Родитель только для чтения: `readdir` ещё работает, а снос внутри
            // него — уже нет. Настоящий EACCES вместо подмены fs (в ESM модуль
            // не сконфигурировать).
            fs.chmodSync(parent, 0o500);
            try {
                expect(pruneStaleRoots(parent, () => false)).toEqual([]);
                expect(fs.existsSync(stubborn)).toBe(true);
            } finally {
                fs.chmodSync(parent, 0o700);
            }
        });

        it("владелец чужой (EPERM) — считаем живым, не сносим", () => {
            const foreign = rootOwnedBy(3333);
            const kill = vi.spyOn(process, "kill").mockImplementation(() => {
                throw Object.assign(new Error("not permitted"), { code: "EPERM" });
            });
            try {
                // Без инъекции — через настоящий isAlive, где и живёт разбор EPERM.
                expect(pruneStaleRoots(parent)).toEqual([]);
            } finally {
                kill.mockRestore();
            }
            expect(fs.existsSync(foreign)).toBe(true);
        });

        it("владельца нет (ESRCH) — сносим", () => {
            const dead = rootOwnedBy(4444);
            const kill = vi.spyOn(process, "kill").mockImplementation(() => {
                throw Object.assign(new Error("no such process"), { code: "ESRCH" });
            });
            try {
                expect(pruneStaleRoots(parent)).toEqual([dead]);
            } finally {
                kill.mockRestore();
            }
        });
    });

    describe("setup (globalSetup vitest)", () => {
        const saved = { tmp: process.env.TMPDIR, own: process.env.DIODE_TEST_TMP };

        afterEach(() => {
            process.env.TMPDIR = saved.tmp;
            process.env.DIODE_TEST_TMP = saved.own;
            delete process.env.DIODE_TEST_TMP_PARENT;
        });

        it("направляет TMPDIR в свой корень, а teardown сносит его целиком", () => {
            process.env.DIODE_TEST_TMP_PARENT = parent;

            const teardown = setup();

            const root = process.env.DIODE_TEST_TMP;
            expect(root).toBeDefined();
            expect(process.env.TMPDIR).toBe(root);
            // Главное свойство: тест, не менявший ни строки, пишет уже внутрь корня.
            expect(path.dirname(fs.mkdtempSync(path.join(os.tmpdir(), "inside-")))).toBe(root);
            // Забытое в корне уходит вместе с ним — это и есть страховка от OOM.
            fs.writeFileSync(path.join(root!, "forgotten.txt"), "мусор");

            teardown();

            expect(fs.existsSync(root!)).toBe(false);
        });

        it("подчищает корни мёртвых прогонов и сообщает об этом", () => {
            process.env.DIODE_TEST_TMP_PARENT = parent;
            const dead = rootOwnedBy(1111);
            const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

            const teardown = setup();
            teardown();

            expect(fs.existsSync(dead)).toBe(false);
            expect(info).toHaveBeenCalledWith(expect.stringContaining("подчищено корней"));
            info.mockRestore();
        });

        it("подчищать нечего — молчит", () => {
            process.env.DIODE_TEST_TMP_PARENT = parent;
            const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

            const teardown = setup();
            teardown();

            expect(info).not.toHaveBeenCalled();
            info.mockRestore();
        });

        it("без DIODE_TEST_TMP_PARENT корень заводится в системном tmp", () => {
            const outer = os.tmpdir();

            const teardown = setup();
            try {
                expect(path.dirname(process.env.DIODE_TEST_TMP!)).toBe(outer);
            } finally {
                teardown();
            }
        });
    });
});
