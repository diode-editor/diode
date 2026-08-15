import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    createFileSystemNamespace,
    fileTypeFromStats,
    SubprocessFileSystemProviders,
    toFileSystemError,
} from "./fileSystemNamespace.ts";
import { FileSystemError, FileType, Uri } from "./vscodeTypes.ts";

const wfs = createFileSystemNamespace();
const uri = (p: string) => Uri.file(p) as never;

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-wfs-"));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("FileSystemNamespace — writeFile", () => {
    it("создаёт файл и родительские папки", async () => {
        const target = path.join(tmpDir, "nested", "deep", ".editorconfig");
        await wfs.writeFile(uri(target), Buffer.from("root = true\n", "utf8"));
        expect(fs.existsSync(target)).toBe(true);
        expect(fs.readFileSync(target, "utf8")).toBe("root = true\n");
    });

    it("readFile возвращает записанные байты (roundtrip)", async () => {
        const target = path.join(tmpDir, "a.txt");
        const bytes = Buffer.from("привет\n", "utf8");
        await wfs.writeFile(uri(target), bytes);
        const read = await wfs.readFile(uri(target));
        expect(Buffer.from(read).equals(bytes)).toBe(true);
    });
});

describe("FileSystemNamespace — stat", () => {
    it("файл → FileType.File с размером", async () => {
        const target = path.join(tmpDir, "f.txt");
        fs.writeFileSync(target, "hello");
        const s = await wfs.stat(uri(target));
        expect(s.type).toBe(FileType.File);
        expect(s.size).toBe(5);
        expect(typeof s.mtime).toBe("number");
    });

    it("папка → FileType.Directory", async () => {
        const s = await wfs.stat(uri(tmpDir));
        expect(s.type).toBe(FileType.Directory);
    });

    it("несуществующий путь → FileSystemError с code FileNotFound", async () => {
        const missing = path.join(tmpDir, "nope.txt");
        await expect(wfs.stat(uri(missing))).rejects.toBeInstanceOf(FileSystemError);
        await expect(wfs.stat(uri(missing))).rejects.toMatchObject({ code: "FileNotFound" });
    });
});

describe("FileSystemNamespace — readFile errors", () => {
    it("readFile несуществующего → FileSystemError FileNotFound", async () => {
        const missing = path.join(tmpDir, "nope.txt");
        await expect(wfs.readFile(uri(missing))).rejects.toMatchObject({ code: "FileNotFound" });
    });
});

describe("FileSystemNamespace — writeFile errors", () => {
    it("writeFile под существующим файлом (родитель — не папка) → бросает", async () => {
        // Делаем файл, затем пишем «внутрь» него: mkdir(dirname) упадёт.
        const asFile = path.join(tmpDir, "afile");
        fs.writeFileSync(asFile, "x");
        await expect(wfs.writeFile(uri(path.join(asFile, "child.txt")), Buffer.from("y"))).rejects.toThrow();
    });
});

describe("fileTypeFromStats", () => {
    const kind = (which: "file" | "dir" | "link" | "none") => ({
        isFile: () => which === "file",
        isDirectory: () => which === "dir",
        isSymbolicLink: () => which === "link",
    });
    it("маппит File/Directory/SymbolicLink/Unknown", () => {
        expect(fileTypeFromStats(kind("file"))).toBe(FileType.File);
        expect(fileTypeFromStats(kind("dir"))).toBe(FileType.Directory);
        expect(fileTypeFromStats(kind("link"))).toBe(FileType.SymbolicLink);
        expect(fileTypeFromStats(kind("none"))).toBe(FileType.Unknown);
    });
});

describe("toFileSystemError — маппинг errno", () => {
    const u = uri("/x");
    it("ENOENT → FileNotFound", () => {
        expect(toFileSystemError({ code: "ENOENT" }, u)).toMatchObject({ code: "FileNotFound" });
    });
    it("EEXIST → FileExists", () => {
        expect(toFileSystemError({ code: "EEXIST" }, u)).toMatchObject({ code: "FileExists" });
    });
    it("EACCES / EPERM → NoPermissions", () => {
        expect(toFileSystemError({ code: "EACCES" }, u)).toMatchObject({ code: "NoPermissions" });
        expect(toFileSystemError({ code: "EPERM" }, u)).toMatchObject({ code: "NoPermissions" });
    });
    it("неизвестный код и не-errno пробрасываются как есть", () => {
        const other = new Error("boom");
        expect(toFileSystemError(other, u)).toBe(other);
        expect(toFileSystemError({ code: "EISDIR" }, u)).toEqual({ code: "EISDIR" });
        expect(toFileSystemError(null, u)).toBeNull();
    });
});

/**
 * `workspace.fs` в VS Code — роутер по `uri.scheme`. Локальный диск обслуживает только
 * `file`; для прочих схем нужен честный отказ, а не чтение/запись `uri.fsPath` мимо схемы.
 */
describe("FileSystemNamespace — роутинг по схеме", () => {
    const nonFile = (raw: string) => Uri.parse(raw) as never;

    it.each(["untitled:Untitled-1", "git:/foo.ts?%7B%22ref%22%3A%22HEAD%22%7D", "vscode-vfs://github/o/r/f.ts"])(
        "stat(%s) → FileSystemError.Unavailable",
        async (raw) => {
            await expect(wfs.stat(nonFile(raw))).rejects.toMatchObject({ code: "Unavailable" });
        },
    );

    it("readFile с не-file URI → FileSystemError.Unavailable", async () => {
        await expect(wfs.readFile(nonFile("untitled:Untitled-1"))).rejects.toBeInstanceOf(FileSystemError);
        await expect(wfs.readFile(nonFile("untitled:Untitled-1"))).rejects.toMatchObject({ code: "Unavailable" });
    });

    it("writeFile с не-file URI отказывает и НЕ трогает диск", async () => {
        // Ключевой кейс #107: fsPath у untitled: — относительный "Untitled-1", поэтому
        // без гейта запись ушла бы в $CWD/Untitled-1 вместо ошибки.
        const cwdBefore = process.cwd();
        const stray = path.join(cwdBefore, "Untitled-1");
        expect(fs.existsSync(stray)).toBe(false);

        await expect(wfs.writeFile(nonFile("untitled:Untitled-1"), Buffer.from("x"))).rejects.toMatchObject({
            code: "Unavailable",
        });

        expect(fs.existsSync(stray)).toBe(false);
    });

    it("file-схема продолжает работать", async () => {
        const target = path.join(tmpDir, "ok.txt");
        await wfs.writeFile(uri(target), Buffer.from("hi"));
        expect(fs.readFileSync(target, "utf-8")).toBe("hi");
    });
});

describe("SubprocessFileSystemProviders", () => {
    const gitUri = Uri.parse("git:/repo/a.ts") as never;

    /** Минимальный read-only провайдер: отдаёт текст и умеет вручную фаерить изменения. */
    function provider(content: string) {
        const listeners: ((events: { uri: unknown }[]) => void)[] = [];
        return {
            readFile: () => new TextEncoder().encode(content),
            onDidChangeFile: (cb: (events: never) => void) => {
                listeners.push(cb as never);
                return { dispose: () => listeners.splice(listeners.indexOf(cb as never), 1) };
            },
            stat: () => ({ type: FileType.File, ctime: 0, mtime: 0, size: content.length }),
            watch: () => ({ dispose: () => undefined }),
            fire: (events: { uri: unknown }[]) => {
                for (const cb of [...listeners]) cb(events as never);
            },
        };
    }

    it("readFile уходит провайдеру зарегистрированной схемы", async () => {
        const providers = new SubprocessFileSystemProviders();
        providers.register("git", provider("оригинал") as never);
        const ns = createFileSystemNamespace(providers);

        expect(new TextDecoder().decode(await ns.readFile(gitUri))).toBe("оригинал");
    });

    it("незарегистрированная схема по-прежнему получает Unavailable", async () => {
        const ns = createFileSystemNamespace(new SubprocessFileSystemProviders());
        await expect(ns.readFile(gitUri)).rejects.toMatchObject({ code: "Unavailable" });
    });

    it("схема file идёт на диск даже при наличии провайдеров", async () => {
        const providers = new SubprocessFileSystemProviders();
        providers.register("git", provider("не отсюда") as never);
        const ns = createFileSystemNamespace(providers);

        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "diode-fsns-")), "real.txt");
        fs.writeFileSync(file, "с диска");

        expect(new TextDecoder().decode(await ns.readFile(Uri.file(file) as never))).toBe("с диска");
    });

    it("занятая схема — ошибка регистрации", () => {
        const providers = new SubprocessFileSystemProviders();
        providers.register("git", provider("a") as never);
        expect(() => providers.register("git", provider("b") as never)).toThrow(/already registered/);
    });

    it("снятие регистрации освобождает схему", async () => {
        const providers = new SubprocessFileSystemProviders();
        providers.register("git", provider("a") as never).dispose();
        const ns = createFileSystemNamespace(providers);

        expect(providers.get("git")).toBeUndefined();
        await expect(ns.readFile(gitUri)).rejects.toMatchObject({ code: "Unavailable" });
    });

    it("список схем и его изменения видны наружу", () => {
        const providers = new SubprocessFileSystemProviders();
        const seen: string[][] = [];
        providers.onDidChangeSchemes(() => seen.push(providers.schemes()));

        const registration = providers.register("git", provider("a") as never);
        registration.dispose();
        registration.dispose(); // повторный dispose не должен фаерить снова

        expect(seen).toEqual([["git"], []]);
    });

    it("изменения провайдера пересылаются подписчикам, пустые — нет", () => {
        const providers = new SubprocessFileSystemProviders();
        const p = provider("a");
        providers.register("git", p as never);
        const seen: unknown[][] = [];
        providers.onDidChangeFile((uris) => seen.push(uris));

        p.fire([]);
        p.fire([{ uri: gitUri }]);

        expect(seen).toEqual([[gitUri]]);
    });

    it("после снятия регистрации события провайдера больше не пересылаются", () => {
        const providers = new SubprocessFileSystemProviders();
        const p = provider("a");
        const registration = providers.register("git", p as never);
        const seen: unknown[][] = [];
        providers.onDidChangeFile((uris) => seen.push(uris));

        registration.dispose();
        p.fire([{ uri: gitUri }]);

        expect(seen).toEqual([]);
    });

    it("отписка от событий и от смены схем работает", () => {
        const providers = new SubprocessFileSystemProviders();
        const p = provider("a");
        providers.register("git", p as never);
        const files: unknown[] = [];
        const schemes: unknown[] = [];
        providers.onDidChangeFile((u) => files.push(u)).dispose();
        providers.onDidChangeSchemes(() => schemes.push(1)).dispose();

        p.fire([{ uri: gitUri }]);
        providers.register("output", p as never);

        expect(files).toEqual([]);
        expect(schemes).toEqual([]);
    });
});
