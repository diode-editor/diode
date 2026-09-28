import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFileSystemNamespace } from "./fileSystemNamespace.ts";
import { FileType, Uri } from "./vscodeTypes.ts";

/**
 * Мутирующая и перечисляющая половина `workspace.fs`: `createDirectory`,
 * `readDirectory`, `delete`, `rename`, `copy`, `isWritableFileSystem`.
 *
 * Поднята под стоковый `redhat.java` — он раскладывает `-configuration` jdt.ls в
 * `globalStorageUri` и падал на `fs.createDirectory is not a function`.
 */

const uri = (p: string) => Uri.file(p) as never;

let tmpDir: string;
/**
 * Неймспейс собираем на КАЖДЫЙ тест, а не один раз на модуль: сборка на уровне
 * модуля случается вне теста, и per-test-покрытие Stryker'а не приписывает её
 * ни одному из них — мутант в замыкании фабрики отмечается «покрытым» чужими
 * сьютами и выживает при живом ассерте.
 */
let wfs: ReturnType<typeof createFileSystemNamespace>;

beforeEach(() => {
    wfs = createFileSystemNamespace();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-wfs-mut-"));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("workspace.fs — createDirectory", () => {
    it("создаёт каталог вместе с недостающими родителями (mkdirp по контракту)", async () => {
        const target = path.join(tmpDir, "a", "b", "config_linux");
        await wfs.createDirectory(uri(target));
        expect(fs.statSync(target).isDirectory()).toBe(true);
    });

    it("на существующем каталоге не падает (повторная раскладка jdt.ls)", async () => {
        const target = path.join(tmpDir, "again");
        await wfs.createDirectory(uri(target));
        await expect(wfs.createDirectory(uri(target))).resolves.toBeUndefined();
    });

    it("по пути существующего ФАЙЛА — ошибка, а не тихий успех", async () => {
        const target = path.join(tmpDir, "occupied");
        fs.writeFileSync(target, "x");
        await expect(wfs.createDirectory(uri(target))).rejects.toMatchObject({ code: "FileExists" });
    });

    it("не-file схема отказывает и ничего не создаёт", async () => {
        await expect(wfs.createDirectory(Uri.parse("untitled:nope") as never)).rejects.toMatchObject({
            code: "Unavailable",
        });
    });
});

describe("workspace.fs — readDirectory", () => {
    it("отдаёт пары имя/тип, различая файл и каталог", async () => {
        fs.writeFileSync(path.join(tmpDir, "pom.xml"), "<project/>");
        fs.mkdirSync(path.join(tmpDir, "src"));
        const entries = await wfs.readDirectory(uri(tmpDir));
        expect([...entries].toSorted((a, b) => a[0].localeCompare(b[0]))).toEqual([
            ["pom.xml", FileType.File],
            ["src", FileType.Directory],
        ]);
    });

    it("симлинк помечен как SymbolicLink, а не как его цель", async () => {
        fs.writeFileSync(path.join(tmpDir, "real.txt"), "x");
        fs.symlinkSync(path.join(tmpDir, "real.txt"), path.join(tmpDir, "link.txt"));
        const entries = await wfs.readDirectory(uri(tmpDir));
        expect(entries.find((e) => e[0] === "link.txt")?.[1]).toBe(FileType.SymbolicLink);
    });

    it("пустой каталог — пустой список", async () => {
        await expect(wfs.readDirectory(uri(tmpDir))).resolves.toEqual([]);
    });

    it("несуществующий каталог → FileNotFound", async () => {
        await expect(wfs.readDirectory(uri(path.join(tmpDir, "нет")))).rejects.toMatchObject({
            code: "FileNotFound",
        });
    });

    it("не-file схема → Unavailable", async () => {
        await expect(wfs.readDirectory(Uri.parse("untitled:nope") as never)).rejects.toMatchObject({
            code: "Unavailable",
        });
    });
});

describe("workspace.fs — delete", () => {
    it("удаляет файл", async () => {
        const target = path.join(tmpDir, "f.txt");
        fs.writeFileSync(target, "x");
        await wfs.delete(uri(target));
        expect(fs.existsSync(target)).toBe(false);
    });

    it("непустой каталог БЕЗ recursive — отказ, каталог на месте", async () => {
        const dir = path.join(tmpDir, "jdt_ws");
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, "inside"), "x");
        await expect(wfs.delete(uri(dir))).rejects.toBeDefined();
        expect(fs.existsSync(dir)).toBe(true);
    });

    it("непустой каталог С recursive — сносится целиком", async () => {
        const dir = path.join(tmpDir, "jdt_ws");
        fs.mkdirSync(path.join(dir, "nested"), { recursive: true });
        fs.writeFileSync(path.join(dir, "nested", "inside"), "x");
        await wfs.delete(uri(dir), { recursive: true });
        expect(fs.existsSync(dir)).toBe(false);
    });

    it("несуществующий ресурс → FileNotFound, а не вакуумный успех", async () => {
        await expect(wfs.delete(uri(path.join(tmpDir, "нет")))).rejects.toMatchObject({ code: "FileNotFound" });
    });

    it("не-file схема → Unavailable", async () => {
        await expect(wfs.delete(Uri.parse("untitled:nope") as never)).rejects.toMatchObject({ code: "Unavailable" });
    });
});

describe("workspace.fs — rename", () => {
    it("переносит файл на свободное место", async () => {
        const from = path.join(tmpDir, "a.txt");
        const to = path.join(tmpDir, "b.txt");
        fs.writeFileSync(from, "payload");
        await wfs.rename(uri(from), uri(to));
        expect(fs.existsSync(from)).toBe(false);
        expect(fs.readFileSync(to, "utf8")).toBe("payload");
    });

    it("занятая цель без overwrite → FileExists, ОБА файла целы", async () => {
        const from = path.join(tmpDir, "a.txt");
        const to = path.join(tmpDir, "b.txt");
        fs.writeFileSync(from, "src");
        fs.writeFileSync(to, "dst");
        await expect(wfs.rename(uri(from), uri(to))).rejects.toMatchObject({ code: "FileExists" });
        expect(fs.readFileSync(from, "utf8")).toBe("src");
        expect(fs.readFileSync(to, "utf8")).toBe("dst");
    });

    it("занятая цель с overwrite — цель заменяется", async () => {
        const from = path.join(tmpDir, "a.txt");
        const to = path.join(tmpDir, "b.txt");
        fs.writeFileSync(from, "src");
        fs.writeFileSync(to, "dst");
        await wfs.rename(uri(from), uri(to), { overwrite: true });
        expect(fs.readFileSync(to, "utf8")).toBe("src");
        expect(fs.existsSync(from)).toBe(false);
    });

    it("несуществующий источник → FileNotFound, и назван ИСТОЧНИК, а не цель", async () => {
        const from = path.join(tmpDir, "missing-source.txt");
        const to = path.join(tmpDir, "free-target.txt");
        const err = await wfs.rename(uri(from), uri(to)).then(
            () => null,
            (e: unknown) => e as Error & { code?: string },
        );
        expect(err?.code).toBe("FileNotFound");
        expect(err?.message).toContain("missing-source.txt");
        expect(err?.message).not.toContain("free-target.txt");
    });

    it("не-file схема с любой стороны → Unavailable", async () => {
        const real = path.join(tmpDir, "a.txt");
        fs.writeFileSync(real, "x");
        await expect(wfs.rename(Uri.parse("untitled:a") as never, uri(real))).rejects.toMatchObject({
            code: "Unavailable",
        });
        await expect(wfs.rename(uri(real), Uri.parse("untitled:b") as never)).rejects.toMatchObject({
            code: "Unavailable",
        });
    });
});

describe("workspace.fs — copy", () => {
    it("копирует файл, оставляя источник на месте", async () => {
        const from = path.join(tmpDir, "a.txt");
        const to = path.join(tmpDir, "b.txt");
        fs.writeFileSync(from, "payload");
        await wfs.copy(uri(from), uri(to));
        expect(fs.readFileSync(from, "utf8")).toBe("payload");
        expect(fs.readFileSync(to, "utf8")).toBe("payload");
    });

    it("копирует дерево целиком (так jdt.ls раскладывает -configuration)", async () => {
        const from = path.join(tmpDir, "config_linux");
        fs.mkdirSync(path.join(from, "nested"), { recursive: true });
        fs.writeFileSync(path.join(from, "nested", "config.ini"), "osgi");
        const to = path.join(tmpDir, "copied", "config_linux");
        await wfs.copy(uri(from), uri(to));
        expect(fs.readFileSync(path.join(to, "nested", "config.ini"), "utf8")).toBe("osgi");
    });

    it("занятая цель без overwrite → FileExists, цель не тронута", async () => {
        const from = path.join(tmpDir, "a.txt");
        const to = path.join(tmpDir, "b.txt");
        fs.writeFileSync(from, "src");
        fs.writeFileSync(to, "dst");
        await expect(wfs.copy(uri(from), uri(to))).rejects.toMatchObject({ code: "FileExists" });
        expect(fs.readFileSync(to, "utf8")).toBe("dst");
    });

    it("занятая цель с overwrite — цель перезаписывается", async () => {
        const from = path.join(tmpDir, "a.txt");
        const to = path.join(tmpDir, "b.txt");
        fs.writeFileSync(from, "src");
        fs.writeFileSync(to, "dst");
        await wfs.copy(uri(from), uri(to), { overwrite: true });
        expect(fs.readFileSync(to, "utf8")).toBe("src");
    });

    it("несуществующий источник → FileNotFound", async () => {
        await expect(wfs.copy(uri(path.join(tmpDir, "нет")), uri(path.join(tmpDir, "b")))).rejects.toMatchObject({
            code: "FileNotFound",
        });
    });

    it("не-file схема с любой стороны → Unavailable", async () => {
        const real = path.join(tmpDir, "a.txt");
        fs.writeFileSync(real, "x");
        await expect(wfs.copy(Uri.parse("untitled:a") as never, uri(real))).rejects.toMatchObject({
            code: "Unavailable",
        });
        await expect(wfs.copy(uri(real), Uri.parse("untitled:b") as never)).rejects.toMatchObject({
            code: "Unavailable",
        });
    });
});

describe("workspace.fs — isWritableFileSystem", () => {
    it("file — записываема", () => {
        expect(wfs.isWritableFileSystem("file")).toBe(true);
    });

    it("чужая схема — undefined («редактор не знает такой ФС»), а не false", () => {
        expect(wfs.isWritableFileSystem("git")).toBeUndefined();
        expect(wfs.isWritableFileSystem("jdt")).toBeUndefined();
    });
});
