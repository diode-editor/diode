import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    ensureExtensionStorageParents,
    fallbackExtensionStorageHomes,
    type IExtensionStorageHomes,
    resolveExtensionStoragePaths,
} from "./extensionStoragePaths.ts";

describe("resolveExtensionStoragePaths", () => {
    const homes: IExtensionStorageHomes = {
        globalStorageHome: path.join(path.sep, "ud", "globalStorage"),
        workspaceStorageHome: path.join(path.sep, "ud", "workspaceStorage", "abc123"),
        logsHome: path.join(path.sep, "ud", "logs"),
    };

    it("кладёт каталог расширения внутрь каждого корня по его id", () => {
        const paths = resolveExtensionStoragePaths(homes, "supermaven.supermaven");
        expect(paths.globalStoragePath).toBe(path.join(homes.globalStorageHome, "supermaven.supermaven"));
        expect(paths.storagePath).toBe(
            path.join(path.sep, "ud", "workspaceStorage", "abc123", "supermaven.supermaven"),
        );
        expect(paths.logPath).toBe(path.join(homes.logsHome, "supermaven.supermaven"));
    });

    // Асимметрия эталона, а не наша вольность: ExtensionStoragePaths.globalValue
    // берёт `identifier.value.toLowerCase()`, workspaceValue и logUri — id как есть.
    // Расширение ищет уже скачанный движок по тому же правилу, по которому мы его отдали.
    it("globalStorage — по lowercase id, workspaceStorage и logs — по id как есть", () => {
        const paths = resolveExtensionStoragePaths(homes, "Publisher.MixedCase");
        expect(paths.globalStoragePath).toBe(path.join(homes.globalStorageHome, "publisher.mixedcase"));
        expect(paths.storagePath).toBe(path.join(path.sep, "ud", "workspaceStorage", "abc123", "Publisher.MixedCase"));
        expect(paths.logPath).toBe(path.join(homes.logsHome, "Publisher.MixedCase"));
    });

    it("без воркспейсного корня storagePath — null (папка не открыта)", () => {
        const paths = resolveExtensionStoragePaths({ ...homes, workspaceStorageHome: null }, "test.ext");
        expect(paths.storagePath).toBeNull();
        // Остальные два — на месте: они от папки не зависят.
        expect(paths.globalStoragePath).toBe(path.join(homes.globalStorageHome, "test.ext"));
        expect(paths.logPath).toBe(path.join(homes.logsHome, "test.ext"));
    });
});

describe("ensureExtensionStorageParents", () => {
    let tmp: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diode-extstorage-"));
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("создаёт все три корня рекурсивно", () => {
        const homes: IExtensionStorageHomes = {
            globalStorageHome: path.join(tmp, "user-data", "User", "globalStorage"),
            workspaceStorageHome: path.join(tmp, "user-data", "User", "workspaceStorage", "hash"),
            logsHome: path.join(tmp, "user-data", "logs"),
        };
        ensureExtensionStorageParents(homes);
        expect(fs.existsSync(homes.globalStorageHome)).toBe(true);
        expect(fs.existsSync(homes.workspaceStorageHome!)).toBe(true);
        expect(fs.existsSync(homes.logsHome)).toBe(true);
    });

    it("каталог самого расширения НЕ создаёт — по контракту его создаёт расширение", () => {
        const homes: IExtensionStorageHomes = {
            globalStorageHome: path.join(tmp, "globalStorage"),
            workspaceStorageHome: null,
            logsHome: path.join(tmp, "logs"),
        };
        ensureExtensionStorageParents(homes);
        const { globalStoragePath } = resolveExtensionStoragePaths(homes, "test.ext");
        expect(fs.existsSync(path.dirname(globalStoragePath))).toBe(true);
        expect(fs.existsSync(globalStoragePath)).toBe(false);
    });

    it("null-корень пропускает, не падая", () => {
        const homes: IExtensionStorageHomes = {
            globalStorageHome: path.join(tmp, "g"),
            workspaceStorageHome: null,
            logsHome: path.join(tmp, "l"),
        };
        expect(() => {
            ensureExtensionStorageParents(homes);
        }).not.toThrow();
        expect(fs.readdirSync(tmp).sort()).toEqual(["g", "l"]);
    });

    // Недоступный на запись user-data не должен рубить активацию: расширение
    // получит путь и упадёт (или не упадёт) само, остальные продолжат жить.
    it("неудачу mkdir отдаёт в onError и идёт дальше", () => {
        const blocker = path.join(tmp, "blocker");
        fs.writeFileSync(blocker, "не каталог");
        const homes: IExtensionStorageHomes = {
            globalStorageHome: path.join(blocker, "globalStorage"),
            workspaceStorageHome: null,
            logsHome: path.join(tmp, "logs"),
        };
        const failures: string[] = [];
        ensureExtensionStorageParents(homes, (dir, err) => {
            failures.push(dir);
            expect(err).toBeInstanceOf(Error);
        });
        expect(failures).toEqual([homes.globalStorageHome]);
        // Следующий корень всё равно создан.
        expect(fs.existsSync(homes.logsHome)).toBe(true);
    });

    it("без onError неудача mkdir глотается", () => {
        const blocker = path.join(tmp, "file");
        fs.writeFileSync(blocker, "x");
        expect(() => {
            ensureExtensionStorageParents({
                globalStorageHome: path.join(blocker, "g"),
                workspaceStorageHome: null,
                logsHome: path.join(tmp, "l"),
            });
        }).not.toThrow();
    });
});

describe("fallbackExtensionStorageHomes", () => {
    it("корни во временных файлах ОС, воркспейсного нет", () => {
        const homes = fallbackExtensionStorageHomes();
        const root = path.join(os.tmpdir(), "diode-extension-storage");
        expect(homes.globalStorageHome).toBe(path.join(root, "globalStorage"));
        expect(homes.logsHome).toBe(path.join(root, "logs"));
        expect(homes.workspaceStorageHome).toBeNull();
    });
});
