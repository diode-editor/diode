import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { removeDirLoud } from "./removeDirLoud.ts";

describe("removeDirLoud", () => {
    let parent: string;

    beforeEach(() => {
        parent = fs.mkdtempSync(path.join(os.tmpdir(), "rmloud-case-"));
    });

    afterEach(() => {
        fs.chmodSync(parent, 0o700);
        fs.rmSync(parent, { recursive: true, force: true });
    });

    it("сносит каталог вместе с содержимым", () => {
        const dir = path.join(parent, "doomed");
        fs.mkdirSync(path.join(dir, "nested"), { recursive: true });
        fs.writeFileSync(path.join(dir, "nested", "file.txt"), "мусор");

        removeDirLoud(dir, "case");

        expect(fs.existsSync(dir)).toBe(false);
    });

    it("каталога уже нет — это не ошибка и не повод шуметь", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        removeDirLoud(path.join(parent, "нет-такого"), "case");

        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it.skipIf(process.platform === "win32")("снести не удалось — предупреждаем, но не роняем прогон", () => {
        const dir = path.join(parent, "stubborn");
        fs.mkdirSync(dir);
        // Родитель только для чтения: удалить запись из него уже нельзя —
        // настоящий EACCES вместо подмены fs (в ESM модуль не сконфигурировать).
        fs.chmodSync(parent, 0o500);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        expect(() => {
            removeDirLoud(dir, "ExtensionTestHarness");
        }).not.toThrow();

        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("[ExtensionTestHarness] не удалось снести временный каталог"),
            expect.anything(),
        );
        expect(fs.existsSync(dir)).toBe(true);
        warn.mockRestore();
    });
});
