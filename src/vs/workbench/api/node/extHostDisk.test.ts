import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { Uri } from "../common/vscodeTypes.ts";
import { FileType } from "../common/vscodeTypes.ts";

import { createNodeFindFilesScanner, fileTypeFromStats, toFileSystemError } from "./extHostDisk.ts";

const uri = (p: string) => Uri.file(p) as never;

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

describe("createNodeFindFilesScanner", () => {
    it("читает настоящий каталог и различает файлы и папки", async () => {
        const scanner = createNodeFindFilesScanner();
        const entries = await scanner.readDirectory(path.resolve(import.meta.dirname));
        const self = entries.find((e) => e.name === "extHostDisk.test.ts");
        expect(self).toEqual({ name: "extHostDisk.test.ts", isDirectory: false });
    });

    it("недоступный каталог — пустой список, а не исключение", async () => {
        const scanner = createNodeFindFilesScanner();
        await expect(scanner.readDirectory(path.join(import.meta.dirname, "нет-такого-каталога"))).resolves.toEqual([]);
    });
});
