import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import {
    FileOperationResult,
    FileSystemProviderCapabilities,
    FileType,
    isFileOperationError,
} from "../common/files.ts";

import { DiskFileSystemProvider, toFileOperationError } from "./diskFileSystemProvider.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

async function failure(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
    } catch (e) {
        return e;
    }
    throw new Error("expected a failure");
}

describe("DiskFileSystemProvider", () => {
    let dir: string;
    let provider: DiskFileSystemProvider;
    const at = (...parts: string[]): Uri => Uri.file(path.join(dir, ...parts));

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-diskfs-"));
        provider = new DiskFileSystemProvider();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("умеет атомарную запись; изменения снаружи не отслеживает", () => {
        expect(provider.capabilities).toBe(FileSystemProviderCapabilities.FileAtomicWrite);
        const listener = vi.fn();
        provider.onDidChangeFile(listener).dispose();
        expect(listener).not.toHaveBeenCalled();
    });

    it("readFile читает байты; нет файла — NotFound", async () => {
        fs.writeFileSync(path.join(dir, "a.txt"), "привет, диск");
        expect(new TextDecoder().decode(await provider.readFile(at("a.txt")))).toBe("привет, диск");
        const error = await failure(() => provider.readFile(at("missing.txt")));
        expect(isFileOperationError(error, FileOperationResult.NotFound)).toBe(true);
    });

    it("stat: файл, каталог, симлинк на файл и висячий симлинк", async () => {
        fs.writeFileSync(path.join(dir, "a.txt"), "12345");
        fs.mkdirSync(path.join(dir, "d"));
        fs.symlinkSync(path.join(dir, "a.txt"), path.join(dir, "link"));
        fs.symlinkSync(path.join(dir, "nowhere"), path.join(dir, "dangling"));

        const file = await provider.stat(at("a.txt"));
        expect(file.type).toBe(FileType.File);
        expect(file.size).toBe(5);
        expect(file.mtime).toBe(fs.statSync(path.join(dir, "a.txt")).mtimeMs);
        expect((await provider.stat(at("d"))).type).toBe(FileType.Directory);
        const link = await provider.stat(at("link"));
        expect(link.type).toBe(FileType.SymbolicLink | FileType.File);
        expect(link.size).toBe(5);
        expect((await provider.stat(at("dangling"))).type).toBe(FileType.SymbolicLink | FileType.Unknown);
        expect(
            isFileOperationError(await failure(() => provider.stat(at("missing"))), FileOperationResult.NotFound),
        ).toBe(true);
    });

    it("readdir отдаёт имена с типами, симлинки — с типом цели", async () => {
        fs.writeFileSync(path.join(dir, "a.txt"), "");
        fs.mkdirSync(path.join(dir, "d"));
        fs.symlinkSync(path.join(dir, "d"), path.join(dir, "link"));
        fs.symlinkSync(path.join(dir, "nowhere"), path.join(dir, "dangling"));
        expect((await provider.readdir(at())).sort()).toEqual([
            ["a.txt", FileType.File],
            ["d", FileType.Directory],
            ["dangling", FileType.SymbolicLink | FileType.Unknown],
            ["link", FileType.SymbolicLink | FileType.Directory],
        ]);
        expect(
            isFileOperationError(await failure(() => provider.readdir(at("missing"))), FileOperationResult.NotFound),
        ).toBe(true);
    });

    it("запись на месте и атомарная; временный сосед не остаётся", async () => {
        await provider.writeFile(at("a.txt"), bytes("plain"), { atomic: false });
        expect(fs.readFileSync(path.join(dir, "a.txt"), "utf-8")).toBe("plain");

        const inodeBefore = fs.statSync(path.join(dir, "a.txt")).ino;
        await provider.writeFile(at("a.txt"), bytes("atomic"), { atomic: true });
        expect(fs.readFileSync(path.join(dir, "a.txt"), "utf-8")).toBe("atomic");
        // Атомарная замена — это новый файл (rename соседа), а не правка на месте.
        expect(fs.statSync(path.join(dir, "a.txt")).ino).not.toBe(inodeBefore);
        const rename = vi.spyOn(fs.promises, "rename");
        await provider.writeFile(at("new.txt"), bytes("fresh"), { atomic: true });
        // Нового файла ещё нет — его тоже пишем через соседа.
        expect(rename).toHaveBeenCalledOnce();
        expect(fs.readFileSync(path.join(dir, "new.txt"), "utf-8")).toBe("fresh");
        expect(fs.readdirSync(dir).sort()).toEqual(["a.txt", "new.txt"]);
    });

    it("атомарная запись в симлинк и в файл с жёсткими ссылками идёт на месте", async () => {
        fs.writeFileSync(path.join(dir, "target.txt"), "old");
        fs.symlinkSync(path.join(dir, "target.txt"), path.join(dir, "link.txt"));
        await provider.writeFile(at("link.txt"), bytes("via link"), { atomic: true });
        expect(fs.lstatSync(path.join(dir, "link.txt")).isSymbolicLink()).toBe(true);
        expect(fs.readFileSync(path.join(dir, "target.txt"), "utf-8")).toBe("via link");

        fs.linkSync(path.join(dir, "target.txt"), path.join(dir, "hard.txt"));
        const inode = fs.statSync(path.join(dir, "hard.txt")).ino;
        await provider.writeFile(at("hard.txt"), bytes("shared"), { atomic: true });
        expect(fs.statSync(path.join(dir, "hard.txt")).ino).toBe(inode);
        expect(fs.readFileSync(path.join(dir, "target.txt"), "utf-8")).toBe("shared");
    });

    it("упавшая атомарная запись убирает временного соседа и сообщает ошибку", async () => {
        fs.mkdirSync(path.join(dir, "d"));
        // Цель — каталог: rename файла поверх каталога падает.
        const error = await failure(() => provider.writeFile(at("d"), bytes("x"), { atomic: true }));
        expect(isFileOperationError(error, FileOperationResult.IsDirectory)).toBe(true);
        expect(fs.readdirSync(dir)).toEqual(["d"]);
    });

    it("запись в несуществующий каталог — NotFound (и на месте, и атомарно)", async () => {
        for (const atomic of [false, true]) {
            const error = await failure(() => provider.writeFile(at("no", "a.txt"), bytes(""), { atomic }));
            expect(isFileOperationError(error, FileOperationResult.NotFound)).toBe(true);
        }
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it.skipIf(process.platform === "win32")("устройство — тип Unknown", async () => {
        expect((await provider.stat(Uri.file("/dev/null"))).type).toBe(FileType.Unknown);
    });

    it("mkdir с родителями; delete файла и каталога рекурсивно", async () => {
        await provider.mkdir(at("a", "b", "c"));
        expect(fs.statSync(path.join(dir, "a", "b", "c")).isDirectory()).toBe(true);
        fs.writeFileSync(path.join(dir, "a", "f"), "");
        await provider.delete(at("a", "f"), { recursive: false });
        expect(fs.existsSync(path.join(dir, "a", "f"))).toBe(false);
        await expect(provider.delete(at("a"), { recursive: false })).rejects.toThrow();
        await provider.delete(at("a"), { recursive: true });
        expect(fs.existsSync(path.join(dir, "a"))).toBe(false);
        const error = await failure(() => provider.delete(at("a"), { recursive: true }));
        expect(isFileOperationError(error, FileOperationResult.NotFound)).toBe(true);
    });

    it("rename и copy: занятая цель без overwrite — Exists, с overwrite — замена", async () => {
        fs.writeFileSync(path.join(dir, "a"), "a");
        fs.writeFileSync(path.join(dir, "b"), "b");
        for (const run of [
            () => provider.rename(at("a"), at("b"), { overwrite: false }),
            () => provider.copy(at("a"), at("b"), { overwrite: false }),
        ]) {
            const error = await failure(run);
            expect(isFileOperationError(error, FileOperationResult.Exists)).toBe(true);
            expect((error as Error).message).toBe(`'${at("b").toString()}' already exists`);
        }

        await provider.copy(at("a"), at("c"), { overwrite: false });
        await provider.copy(at("a"), at("b"), { overwrite: true });
        expect(fs.readFileSync(path.join(dir, "b"), "utf-8")).toBe("a");
        await provider.rename(at("c"), at("b"), { overwrite: true });
        await provider.rename(at("b"), at("moved"), { overwrite: false });
        expect(fs.readdirSync(dir).sort()).toEqual(["a", "moved"]);

        fs.mkdirSync(path.join(dir, "tree", "sub"), { recursive: true });
        fs.writeFileSync(path.join(dir, "tree", "sub", "x"), "x");
        await provider.copy(at("tree"), at("tree2"), { overwrite: false });
        expect(fs.readFileSync(path.join(dir, "tree2", "sub", "x"), "utf-8")).toBe("x");

        const missing = await failure(() => provider.rename(at("missing"), at("z"), { overwrite: false }));
        expect(isFileOperationError(missing, FileOperationResult.NotFound)).toBe(true);
    });

    it("rename между файловыми системами (EXDEV) — копирование и удаление", async () => {
        fs.mkdirSync(path.join(dir, "src", "sub"), { recursive: true });
        fs.writeFileSync(path.join(dir, "src", "sub", "x"), "x");
        const exdev = Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });
        vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(exdev);
        await provider.rename(at("src"), at("dst"), { overwrite: false });
        expect(fs.readFileSync(path.join(dir, "dst", "sub", "x"), "utf-8")).toBe("x");
        expect(fs.existsSync(path.join(dir, "src"))).toBe(false);

        vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(Object.assign(new Error("EBUSY"), { code: "EBUSY" }));
        await expect(provider.rename(at("dst"), at("again"), { overwrite: false })).rejects.toThrow("EBUSY");
        expect(fs.existsSync(path.join(dir, "dst"))).toBe(true);
    });

    it("коды ОС переводятся в общий словарь, прочие ошибки — как есть", () => {
        const uri = at("x");
        const cases: [string, FileOperationResult][] = [
            ["ENOENT", FileOperationResult.NotFound],
            ["ENOTDIR", FileOperationResult.NotFound],
            ["EISDIR", FileOperationResult.IsDirectory],
            ["EEXIST", FileOperationResult.Exists],
            ["EACCES", FileOperationResult.PermissionDenied],
            ["EPERM", FileOperationResult.PermissionDenied],
        ];
        for (const [code, result] of cases) {
            const mapped = toFileOperationError(Object.assign(new Error(`${code}: boom`), { code }), uri);
            expect(isFileOperationError(mapped, result)).toBe(true);
            expect((mapped as Error).message).toBe(`'${uri.toString()}': ${code}: boom`);
        }
        const other = Object.assign(new Error("busy"), { code: "EBUSY" });
        expect(toFileOperationError(other, uri)).toBe(other);
        const plain = new Error("plain");
        expect(toFileOperationError(plain, uri)).toBe(plain);
        expect(toFileOperationError(null, uri)).toBeNull();
    });
});
