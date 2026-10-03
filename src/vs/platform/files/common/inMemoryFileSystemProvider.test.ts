import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";

import { FileOperationResult, FileSystemProviderCapabilities, FileType, isFileOperationError } from "./files.ts";
import { InMemoryFileSystemProvider } from "./inMemoryFileSystemProvider.ts";

const mem = (path: string): Uri => Uri.from({ scheme: "mem", path });
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (value: Uint8Array): string => new TextDecoder().decode(value);
const atomic = { atomic: false };

async function failure(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
    } catch (e) {
        return e;
    }
    throw new Error("expected a failure");
}

async function expectResult(run: () => Promise<unknown>, result: FileOperationResult, message: string): Promise<void> {
    const error = await failure(run);
    expect(isFileOperationError(error, result)).toBe(true);
    expect((error as Error).message).toBe(message);
}

describe("InMemoryFileSystemProvider", () => {
    it("пустое дерево: только корень-каталог, событий извне нет", async () => {
        const provider = new InMemoryFileSystemProvider();
        expect(provider.capabilities).toBe(FileSystemProviderCapabilities.None);
        expect(await provider.stat(mem("/"))).toEqual({ type: FileType.Directory, mtime: 0, size: 0 });
        expect(await provider.readdir(mem("/"))).toEqual([]);
        await expectResult(
            () => provider.stat(mem("/a")),
            FileOperationResult.NotFound,
            "'/a': no such file or directory",
        );
    });

    it("запись и чтение; mtime растёт на каждой записи", async () => {
        const provider = new InMemoryFileSystemProvider();
        await provider.writeFile(mem("/a.txt"), bytes("one"), atomic);
        const first = await provider.stat(mem("/a.txt"));
        await provider.writeFile(mem("/a.txt"), bytes("three"), atomic);
        const second = await provider.stat(mem("/a.txt"));
        expect(text(await provider.readFile(mem("/a.txt")))).toBe("three");
        expect(first).toEqual({ type: FileType.File, mtime: 1, size: 3 });
        expect(second).toEqual({ type: FileType.File, mtime: 2, size: 5 });
    });

    it("запись без родителя и поверх каталога — отказ; чтение каталога — отказ", async () => {
        const provider = new InMemoryFileSystemProvider();
        await expectResult(
            () => provider.writeFile(mem("/no/a.txt"), bytes(""), atomic),
            FileOperationResult.NotFound,
            "'/no': no such directory",
        );
        await provider.mkdir(mem("/d"));
        await expectResult(
            () => provider.writeFile(mem("/d"), bytes(""), atomic),
            FileOperationResult.IsDirectory,
            "'/d': is a directory",
        );
        await expectResult(() => provider.readFile(mem("/d")), FileOperationResult.IsDirectory, "'/d': is a directory");
        await provider.writeFile(mem("/f"), bytes(""), atomic);
        await expectResult(
            () => provider.writeFile(mem("/f/x"), bytes(""), atomic),
            FileOperationResult.NotFound,
            "'/f': no such directory",
        );
    });

    it("mkdir создаёт недостающих родителей, существующий каталог не трогает, поверх файла — отказ", async () => {
        const provider = new InMemoryFileSystemProvider();
        await provider.mkdir(mem("/a/b/c"));
        // Каталоги тоже получают свежее время изменения, каждый — своё.
        expect(await provider.stat(mem("/a/b/c"))).toEqual({ type: FileType.Directory, mtime: 1, size: 0 });
        expect((await provider.stat(mem("/a"))).mtime).toBe(3);
        expect((await provider.stat(mem("/a"))).type).toBe(FileType.Directory);
        expect((await provider.stat(mem("/a/b/c"))).type).toBe(FileType.Directory);
        const before = await provider.stat(mem("/a"));
        await provider.mkdir(mem("/a"));
        expect(await provider.stat(mem("/a"))).toEqual(before);

        await provider.writeFile(mem("/a/f"), bytes(""), atomic);
        await expectResult(() => provider.mkdir(mem("/a/f")), FileOperationResult.Exists, "'/a/f': a file exists");
    });

    it("readdir — только прямые дети, с типами", async () => {
        const provider = new InMemoryFileSystemProvider();
        await provider.mkdir(mem("/d/sub/deep"));
        await provider.writeFile(mem("/d/a.txt"), bytes(""), atomic);
        await provider.writeFile(mem("/top.txt"), bytes(""), atomic);
        expect((await provider.readdir(mem("/d"))).sort()).toEqual([
            ["a.txt", FileType.File],
            ["sub", FileType.Directory],
        ]);
        expect((await provider.readdir(mem("/"))).sort()).toEqual([
            ["d", FileType.Directory],
            ["top.txt", FileType.File],
        ]);
        await expectResult(
            () => provider.readdir(mem("/x")),
            FileOperationResult.NotFound,
            "'/x': no such file or directory",
        );
    });

    it("delete: файл, каталог рекурсивно; непустой без recursive — отказ; соседи с общим префиксом целы", async () => {
        const provider = new InMemoryFileSystemProvider();
        await provider.mkdir(mem("/d/sub"));
        await provider.writeFile(mem("/d/sub/a"), bytes(""), atomic);
        await provider.writeFile(mem("/dd"), bytes("keep"), atomic);

        await expect(provider.delete(mem("/d"), { recursive: false })).rejects.toThrow("'/d' is not empty");
        await provider.delete(mem("/d/sub/a"), { recursive: false });
        await provider.delete(mem("/d"), { recursive: true });
        await expectResult(
            () => provider.stat(mem("/d/sub")),
            FileOperationResult.NotFound,
            "'/d/sub': no such file or directory",
        );
        expect(text(await provider.readFile(mem("/dd")))).toBe("keep");
        await expectResult(
            () => provider.delete(mem("/d"), { recursive: true }),
            FileOperationResult.NotFound,
            "'/d': no such file or directory",
        );
    });

    it("rename переносит поддерево; занятая цель без overwrite — отказ", async () => {
        const provider = new InMemoryFileSystemProvider();
        await provider.mkdir(mem("/src/sub"));
        await provider.writeFile(mem("/src/sub/a"), bytes("a"), atomic);
        await provider.writeFile(mem("/taken"), bytes("t"), atomic);

        await expectResult(
            () => provider.rename(mem("/src"), mem("/taken"), { overwrite: false }),
            FileOperationResult.Exists,
            "'/taken': already exists",
        );
        await provider.rename(mem("/src"), mem("/dst"), { overwrite: false });
        expect(text(await provider.readFile(mem("/dst/sub/a")))).toBe("a");
        await expectResult(
            () => provider.stat(mem("/src")),
            FileOperationResult.NotFound,
            "'/src': no such file or directory",
        );

        await provider.rename(mem("/dst/sub/a"), mem("/taken"), { overwrite: true });
        expect(text(await provider.readFile(mem("/taken")))).toBe("a");
        await expectResult(
            () => provider.rename(mem("/missing"), mem("/x"), { overwrite: true }),
            FileOperationResult.NotFound,
            "'/missing': no such file or directory",
        );
    });

    it("copy оставляет источник на месте", async () => {
        const provider = new InMemoryFileSystemProvider();
        await provider.writeFile(mem("/a"), bytes("a"), atomic);
        await provider.copy(mem("/a"), mem("/b"), { overwrite: false });
        expect(text(await provider.readFile(mem("/a")))).toBe("a");
        expect(text(await provider.readFile(mem("/b")))).toBe("a");
    });
});
