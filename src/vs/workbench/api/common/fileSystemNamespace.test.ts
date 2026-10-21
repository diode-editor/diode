import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { createFileSystemNamespace, SubprocessFileSystemProviders } from "./fileSystemNamespace.ts";
import { FileSystemError, FileType, Uri } from "./vscodeTypes.ts";

const disk = (): ReturnType<typeof createNodeExtHostDisk>["fs"] => createNodeExtHostDisk().fs;
let wfs: ReturnType<typeof createFileSystemNamespace>;
const uri = (p: string) => Uri.file(p) as never;

let tmpDir: string;

beforeEach(() => {
    wfs = createFileSystemNamespace(disk());
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-wfs-"));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("FileSystemNamespace — writeFile", () => {
    it("creates the file and parent folders", async () => {
        const target = path.join(tmpDir, "nested", "deep", ".editorconfig");
        await wfs.writeFile(uri(target), Buffer.from("root = true\n", "utf8"));
        expect(fs.existsSync(target)).toBe(true);
        expect(fs.readFileSync(target, "utf8")).toBe("root = true\n");
    });

    it("readFile returns the written bytes (roundtrip)", async () => {
        const target = path.join(tmpDir, "a.txt");
        const bytes = Buffer.from("\u043f\u0440\u0438\u0432\u0435\u0442\n", "utf8"); // "privet": multi-byte UTF-8 must roundtrip
        await wfs.writeFile(uri(target), bytes);
        const read = await wfs.readFile(uri(target));
        expect(Buffer.from(read).equals(bytes)).toBe(true);
    });
});

describe("FileSystemNamespace — stat", () => {
    it("file → FileType.File with size", async () => {
        const target = path.join(tmpDir, "f.txt");
        fs.writeFileSync(target, "hello");
        const s = await wfs.stat(uri(target));
        expect(s.type).toBe(FileType.File);
        expect(s.size).toBe(5);
        expect(typeof s.mtime).toBe("number");
    });

    it("folder → FileType.Directory", async () => {
        const s = await wfs.stat(uri(tmpDir));
        expect(s.type).toBe(FileType.Directory);
    });

    it("missing path → FileSystemError with code FileNotFound", async () => {
        const missing = path.join(tmpDir, "nope.txt");
        await expect(wfs.stat(uri(missing))).rejects.toBeInstanceOf(FileSystemError);
        await expect(wfs.stat(uri(missing))).rejects.toMatchObject({ code: "FileNotFound" });
    });
});

describe("FileSystemNamespace — readFile errors", () => {
    it("readFile of a missing file → FileSystemError FileNotFound", async () => {
        const missing = path.join(tmpDir, "nope.txt");
        await expect(wfs.readFile(uri(missing))).rejects.toMatchObject({ code: "FileNotFound" });
    });
});

describe("FileSystemNamespace — writeFile errors", () => {
    it("writeFile under an existing file (parent is not a folder) → throws", async () => {
        // Create a file, then write "inside" it: mkdir(dirname) fails.
        const asFile = path.join(tmpDir, "afile");
        fs.writeFileSync(asFile, "x");
        await expect(wfs.writeFile(uri(path.join(asFile, "child.txt")), Buffer.from("y"))).rejects.toThrow();
    });
});

describe("FileSystemNamespace — scheme routing", () => {
    const nonFile = (raw: string) => Uri.parse(raw) as never;

    it.each(["untitled:Untitled-1", "git:/foo.ts?%7B%22ref%22%3A%22HEAD%22%7D", "vscode-vfs://github/o/r/f.ts"])(
        "stat(%s) → FileSystemError.Unavailable",
        async (raw) => {
            await expect(wfs.stat(nonFile(raw))).rejects.toMatchObject({ code: "Unavailable" });
        },
    );

    it("readFile with a non-file URI → FileSystemError.Unavailable", async () => {
        await expect(wfs.readFile(nonFile("untitled:Untitled-1"))).rejects.toBeInstanceOf(FileSystemError);
        await expect(wfs.readFile(nonFile("untitled:Untitled-1"))).rejects.toMatchObject({ code: "Unavailable" });
    });

    it("writeFile with a non-file URI rejects and does NOT touch the disk", async () => {
        // Key case of #107: an untitled: fsPath is the relative "Untitled-1", so
        // without the gate the write would go to $CWD/Untitled-1 instead of failing.
        const cwdBefore = process.cwd();
        const stray = path.join(cwdBefore, "Untitled-1");
        expect(fs.existsSync(stray)).toBe(false);

        await expect(wfs.writeFile(nonFile("untitled:Untitled-1"), Buffer.from("x"))).rejects.toMatchObject({
            code: "Unavailable",
        });

        expect(fs.existsSync(stray)).toBe(false);
    });

    it("file scheme keeps working", async () => {
        const target = path.join(tmpDir, "ok.txt");
        await wfs.writeFile(uri(target), Buffer.from("hi"));
        expect(fs.readFileSync(target, "utf-8")).toBe("hi");
    });
});

describe("SubprocessFileSystemProviders", () => {
    const gitUri = Uri.parse("git:/repo/a.ts") as never;

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

    it("readFile goes to the provider of a registered scheme", async () => {
        const providers = new SubprocessFileSystemProviders();
        providers.register("git", provider("original") as never);
        const ns = createFileSystemNamespace(disk(), providers);

        expect(new TextDecoder().decode(await ns.readFile(gitUri))).toBe("original");
    });

    it("unregistered scheme still gets Unavailable", async () => {
        const ns = createFileSystemNamespace(disk(), new SubprocessFileSystemProviders());
        await expect(ns.readFile(gitUri)).rejects.toMatchObject({ code: "Unavailable" });
    });

    it("file scheme goes to disk even when providers exist", async () => {
        const providers = new SubprocessFileSystemProviders();
        providers.register("git", provider("not from here") as never);
        const ns = createFileSystemNamespace(disk(), providers);

        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "diode-fsns-")), "real.txt");
        fs.writeFileSync(file, "from disk");

        expect(new TextDecoder().decode(await ns.readFile(Uri.file(file) as never))).toBe("from disk");
    });

    it("taken scheme fails registration", () => {
        const providers = new SubprocessFileSystemProviders();
        providers.register("git", provider("a") as never);
        expect(() => providers.register("git", provider("b") as never)).toThrow(/already registered/);
    });

    it("unregistering frees the scheme", async () => {
        const providers = new SubprocessFileSystemProviders();
        providers.register("git", provider("a") as never).dispose();
        const ns = createFileSystemNamespace(disk(), providers);

        expect(providers.get("git")).toBeUndefined();
        await expect(ns.readFile(gitUri)).rejects.toMatchObject({ code: "Unavailable" });
    });

    it("scheme list and its changes are observable", () => {
        const providers = new SubprocessFileSystemProviders();
        const seen: string[][] = [];
        providers.onDidChangeSchemes(() => seen.push(providers.schemes()));

        const registration = providers.register("git", provider("a") as never);
        registration.dispose();
        registration.dispose(); // a repeated dispose must not fire again

        expect(seen).toEqual([["git"], []]);
    });

    it("provider changes are forwarded to listeners, empty ones are not", () => {
        const providers = new SubprocessFileSystemProviders();
        const p = provider("a");
        providers.register("git", p as never);
        const seen: unknown[][] = [];
        providers.onDidChangeFile((uris) => seen.push(uris));

        p.fire([]);
        p.fire([{ uri: gitUri }]);

        expect(seen).toEqual([[gitUri]]);
    });

    it("after unregistering, provider events are no longer forwarded", () => {
        const providers = new SubprocessFileSystemProviders();
        const p = provider("a");
        const registration = providers.register("git", p as never);
        const seen: unknown[][] = [];
        providers.onDidChangeFile((uris) => seen.push(uris));

        registration.dispose();
        p.fire([{ uri: gitUri }]);

        expect(seen).toEqual([]);
    });

    it("unsubscribing from events and scheme changes works", () => {
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
