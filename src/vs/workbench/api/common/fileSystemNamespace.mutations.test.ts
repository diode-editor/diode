import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { createFileSystemNamespace } from "./fileSystemNamespace.ts";
import { FileType, Uri } from "./vscodeTypes.ts";

// Added for the stock extension `redhat.java`: it crashed on `fs.createDirectory is not a function`.

const uri = (p: string) => Uri.file(p) as never;

let tmpDir: string;
/**
 * Built for EACH test: Stryker's per-test coverage attributes a module-level build
 * to no test, and a mutant in the factory survives despite a live assertion.
 */
let wfs: ReturnType<typeof createFileSystemNamespace>;

beforeEach(() => {
    wfs = createFileSystemNamespace(createNodeExtHostDisk().fs);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-wfs-mut-"));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("workspace.fs — createDirectory", () => {
    it("creates the directory with missing parents (mkdirp per contract)", async () => {
        const target = path.join(tmpDir, "a", "b", "config_linux");
        await wfs.createDirectory(uri(target));
        expect(fs.statSync(target).isDirectory()).toBe(true);
    });

    it("does not fail on an existing directory (jdt.ls re-layout)", async () => {
        const target = path.join(tmpDir, "again");
        await wfs.createDirectory(uri(target));
        await expect(wfs.createDirectory(uri(target))).resolves.toBeUndefined();
    });

    it("at the path of an existing FILE it errors instead of silently succeeding", async () => {
        const target = path.join(tmpDir, "occupied");
        fs.writeFileSync(target, "x");
        await expect(wfs.createDirectory(uri(target))).rejects.toMatchObject({ code: "FileExists" });
    });

    it("non-file scheme rejects and creates nothing", async () => {
        await expect(wfs.createDirectory(Uri.parse("untitled:nope") as never)).rejects.toMatchObject({
            code: "Unavailable",
        });
    });
});

describe("workspace.fs — readDirectory", () => {
    it("returns name/type pairs, telling files from directories", async () => {
        fs.writeFileSync(path.join(tmpDir, "pom.xml"), "<project/>");
        fs.mkdirSync(path.join(tmpDir, "src"));
        const entries = await wfs.readDirectory(uri(tmpDir));
        expect([...entries].toSorted((a, b) => a[0].localeCompare(b[0]))).toEqual([
            ["pom.xml", FileType.File],
            ["src", FileType.Directory],
        ]);
    });

    it("symlink is marked SymbolicLink, not as its target", async () => {
        fs.writeFileSync(path.join(tmpDir, "real.txt"), "x");
        fs.symlinkSync(path.join(tmpDir, "real.txt"), path.join(tmpDir, "link.txt"));
        const entries = await wfs.readDirectory(uri(tmpDir));
        expect(entries.find((e) => e[0] === "link.txt")?.[1]).toBe(FileType.SymbolicLink);
    });

    it("empty directory gives an empty list", async () => {
        await expect(wfs.readDirectory(uri(tmpDir))).resolves.toEqual([]);
    });

    it("missing directory → FileNotFound", async () => {
        await expect(wfs.readDirectory(uri(path.join(tmpDir, "missing")))).rejects.toMatchObject({
            code: "FileNotFound",
        });
    });

    it("non-file scheme → Unavailable", async () => {
        await expect(wfs.readDirectory(Uri.parse("untitled:nope") as never)).rejects.toMatchObject({
            code: "Unavailable",
        });
    });
});

describe("workspace.fs — delete", () => {
    it("deletes a file", async () => {
        const target = path.join(tmpDir, "f.txt");
        fs.writeFileSync(target, "x");
        await wfs.delete(uri(target));
        expect(fs.existsSync(target)).toBe(false);
    });

    it("non-empty directory WITHOUT recursive rejects, directory stays", async () => {
        const dir = path.join(tmpDir, "jdt_ws");
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, "inside"), "x");
        await expect(wfs.delete(uri(dir))).rejects.toBeDefined();
        expect(fs.existsSync(dir)).toBe(true);
    });

    it("non-empty directory WITH recursive is removed entirely", async () => {
        const dir = path.join(tmpDir, "jdt_ws");
        fs.mkdirSync(path.join(dir, "nested"), { recursive: true });
        fs.writeFileSync(path.join(dir, "nested", "inside"), "x");
        await wfs.delete(uri(dir), { recursive: true });
        expect(fs.existsSync(dir)).toBe(false);
    });

    it("missing resource → FileNotFound, not a vacuous success", async () => {
        await expect(wfs.delete(uri(path.join(tmpDir, "missing")))).rejects.toMatchObject({ code: "FileNotFound" });
    });

    it("non-file scheme → Unavailable", async () => {
        await expect(wfs.delete(Uri.parse("untitled:nope") as never)).rejects.toMatchObject({ code: "Unavailable" });
    });
});

describe("workspace.fs — rename", () => {
    it("moves a file to a free location", async () => {
        const from = path.join(tmpDir, "a.txt");
        const to = path.join(tmpDir, "b.txt");
        fs.writeFileSync(from, "payload");
        await wfs.rename(uri(from), uri(to));
        expect(fs.existsSync(from)).toBe(false);
        expect(fs.readFileSync(to, "utf8")).toBe("payload");
    });

    it("taken target without overwrite → FileExists, BOTH files intact", async () => {
        const from = path.join(tmpDir, "a.txt");
        const to = path.join(tmpDir, "b.txt");
        fs.writeFileSync(from, "src");
        fs.writeFileSync(to, "dst");
        await expect(wfs.rename(uri(from), uri(to))).rejects.toMatchObject({ code: "FileExists" });
        expect(fs.readFileSync(from, "utf8")).toBe("src");
        expect(fs.readFileSync(to, "utf8")).toBe("dst");
    });

    it("taken target with overwrite replaces the target", async () => {
        const from = path.join(tmpDir, "a.txt");
        const to = path.join(tmpDir, "b.txt");
        fs.writeFileSync(from, "src");
        fs.writeFileSync(to, "dst");
        await wfs.rename(uri(from), uri(to), { overwrite: true });
        expect(fs.readFileSync(to, "utf8")).toBe("src");
        expect(fs.existsSync(from)).toBe(false);
    });

    it("missing source → FileNotFound naming the SOURCE, not the target", async () => {
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

    it("non-file scheme on either side → Unavailable", async () => {
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
    it("copies a file, leaving the source in place", async () => {
        const from = path.join(tmpDir, "a.txt");
        const to = path.join(tmpDir, "b.txt");
        fs.writeFileSync(from, "payload");
        await wfs.copy(uri(from), uri(to));
        expect(fs.readFileSync(from, "utf8")).toBe("payload");
        expect(fs.readFileSync(to, "utf8")).toBe("payload");
    });

    it("copies a whole tree (how jdt.ls lays out -configuration)", async () => {
        const from = path.join(tmpDir, "config_linux");
        fs.mkdirSync(path.join(from, "nested"), { recursive: true });
        fs.writeFileSync(path.join(from, "nested", "config.ini"), "osgi");
        const to = path.join(tmpDir, "copied", "config_linux");
        await wfs.copy(uri(from), uri(to));
        expect(fs.readFileSync(path.join(to, "nested", "config.ini"), "utf8")).toBe("osgi");
    });

    it("taken target without overwrite → FileExists, target untouched", async () => {
        const from = path.join(tmpDir, "a.txt");
        const to = path.join(tmpDir, "b.txt");
        fs.writeFileSync(from, "src");
        fs.writeFileSync(to, "dst");
        await expect(wfs.copy(uri(from), uri(to))).rejects.toMatchObject({ code: "FileExists" });
        expect(fs.readFileSync(to, "utf8")).toBe("dst");
    });

    it("taken target with overwrite overwrites the target", async () => {
        const from = path.join(tmpDir, "a.txt");
        const to = path.join(tmpDir, "b.txt");
        fs.writeFileSync(from, "src");
        fs.writeFileSync(to, "dst");
        await wfs.copy(uri(from), uri(to), { overwrite: true });
        expect(fs.readFileSync(to, "utf8")).toBe("src");
    });

    it("missing source → FileNotFound", async () => {
        await expect(wfs.copy(uri(path.join(tmpDir, "missing")), uri(path.join(tmpDir, "b")))).rejects.toMatchObject({
            code: "FileNotFound",
        });
    });

    it("non-file scheme on either side → Unavailable", async () => {
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
    it("file is writable", () => {
        expect(wfs.isWritableFileSystem("file")).toBe(true);
    });

    it("foreign scheme gives undefined ('editor does not know this file system'), not false", () => {
        expect(wfs.isWritableFileSystem("git")).toBeUndefined();
        expect(wfs.isWritableFileSystem("jdt")).toBeUndefined();
    });
});
