import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { createFileSystemNamespace } from "../common/fileSystemNamespace.ts";
import { FileSystemError, Uri } from "../common/vscodeTypes.ts";
import { FileType } from "../common/vscodeTypes.ts";

import {
    createNodeExtHostDisk,
    createNodeFindFilesScanner,
    fileTypeFromStats,
    toFileSystemError,
} from "./extHostDisk.ts";

const uri = (p: string) => Uri.file(p) as never;

describe("fileTypeFromStats", () => {
    const kind = (which: "file" | "dir" | "link" | "none") => ({
        isFile: () => which === "file",
        isDirectory: () => which === "dir",
        isSymbolicLink: () => which === "link",
    });
    it("maps File/Directory/SymbolicLink/Unknown", () => {
        expect(fileTypeFromStats(kind("file"))).toBe(FileType.File);
        expect(fileTypeFromStats(kind("dir"))).toBe(FileType.Directory);
        expect(fileTypeFromStats(kind("link"))).toBe(FileType.SymbolicLink);
        expect(fileTypeFromStats(kind("none"))).toBe(FileType.Unknown);
    });
});

describe("toFileSystemError — errno mapping", () => {
    const u = uri("/x");
    it("ENOENT → FileNotFound", () => {
        expect(toFileSystemError({ code: "ENOENT" }, u)).toMatchObject({ code: "FileNotFound" });
    });
    it("EEXIST → FileExists", () => {
        expect(toFileSystemError({ code: "EEXIST" }, u)).toMatchObject({ code: "FileExists" });
    });
    it("EISDIR → FileIsADirectory, ENOTDIR → FileNotADirectory", () => {
        expect(toFileSystemError({ code: "EISDIR" }, u)).toMatchObject({ code: "FileIsADirectory" });
        expect(toFileSystemError({ code: "ENOTDIR" }, u)).toMatchObject({ code: "FileNotADirectory" });
    });
    it("EACCES / EPERM → NoPermissions", () => {
        expect(toFileSystemError({ code: "EACCES" }, u)).toMatchObject({ code: "NoPermissions" });
        expect(toFileSystemError({ code: "EPERM" }, u)).toMatchObject({ code: "NoPermissions" });
    });
    it("an unknown code and non-errno errors are passed through as is", () => {
        const other = new Error("boom");
        expect(toFileSystemError(other, u)).toBe(other);
        expect(toFileSystemError({ code: "ELOOP" }, u)).toEqual({ code: "ELOOP" });
        expect(toFileSystemError(null, u)).toBeNull();
    });
});

describe("workspace.fs on a real disk — error codes", () => {
    it("[api:workspace.fs] a path under a file is FileNotADirectory, reading a folder is FileIsADirectory", async () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), "diode-fs-codes-"));
        try {
            const file = path.join(dir, "file.txt");
            writeFileSync(file, "x");
            const fsApi = createFileSystemNamespace(createNodeExtHostDisk().fs);

            const underFile = Uri.file(path.join(file, "child"));
            await expect(fsApi.stat(underFile)).rejects.toMatchObject({ code: "FileNotADirectory" });
            await expect(fsApi.rename(underFile, Uri.file(path.join(dir, "target")))).rejects.toBeInstanceOf(
                FileSystemError,
            );
            await expect(fsApi.readFile(Uri.file(dir))).rejects.toMatchObject({ code: "FileIsADirectory" });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("createNodeFindFilesScanner", () => {
    it("reads a real directory and distinguishes files and folders", async () => {
        const scanner = createNodeFindFilesScanner();
        const entries = await scanner.readDirectory(path.resolve(import.meta.dirname));
        const self = entries.find((e) => e.name === "extHostDisk.test.ts");
        expect(self).toEqual({ name: "extHostDisk.test.ts", isDirectory: false });
    });

    it("an inaccessible directory gives an empty list, not an exception", async () => {
        const scanner = createNodeFindFilesScanner();
        await expect(scanner.readDirectory(path.join(import.meta.dirname, "no-such-directory"))).resolves.toEqual([]);
    });
});
