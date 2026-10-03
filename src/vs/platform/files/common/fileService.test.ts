import { describe, expect, it, vi } from "vitest";

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../TestUtils/disposableLeaks.ts";
import { Emitter, Event } from "../../../base/common/event.ts";
import { Uri } from "../../../base/common/uri.ts";

import {
    etag,
    FileOperation,
    FileOperationError,
    FileOperationResult,
    FileSystemProviderCapabilities,
    FileType,
    type IFileOperationEvent,
    type IFileSystemProvider,
    isFileOperationError,
} from "./files.ts";
import { FileService } from "./fileService.ts";
import { InMemoryFileSystemProvider } from "./inMemoryFileSystemProvider.ts";

const disposables = ensureNoDisposablesAreLeakedInTestSuite();

const mem = (path: string): Uri => Uri.from({ scheme: "mem", path });
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

/** Сервис с in-memory провайдером на схеме `mem` и журналом операций. */
function setup(capabilities?: FileSystemProviderCapabilities): {
    files: FileService;
    provider: InMemoryFileSystemProvider;
    operations: IFileOperationEvent[];
} {
    const files = disposables.add(new FileService());
    const provider = new InMemoryFileSystemProvider();
    if (capabilities !== undefined) Object.assign(provider, { capabilities });
    disposables.add(files.registerProvider("mem", provider));
    const operations: IFileOperationEvent[] = [];
    disposables.add(files.onDidRunOperation((e) => operations.push(e)));
    return { files, provider, operations };
}

/** Провайдер расширения: только чтение, без stat. */
function readonlyProvider(
    content: Partial<Record<string, string>>,
    changes = new Emitter<readonly Uri[]>(),
): IFileSystemProvider {
    return {
        capabilities: FileSystemProviderCapabilities.Readonly,
        onDidChangeFile: changes.event,
        readFile: (uri) => {
            const value = content[uri.path];
            return value === undefined ? Promise.reject(new Error("missing")) : Promise.resolve(bytes(value));
        },
    };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (e) {
        return e;
    }
    throw new Error("expected a rejection");
}

describe("FileService — регистрация провайдеров", () => {
    it("занятая схема — ошибка; снятие регистрации освобождает схему", () => {
        const files = disposables.add(new FileService());
        const seen: unknown[] = [];
        disposables.add(files.onDidChangeFileSystemProviderRegistrations((e) => seen.push(e)));
        const registration = files.registerProvider("mem", new InMemoryFileSystemProvider());
        expect(files.hasProvider(mem("/a"))).toBe(true);
        expect(files.hasProvider(Uri.from({ scheme: "other", path: "/a" }))).toBe(false);
        expect(() => files.registerProvider("mem", new InMemoryFileSystemProvider())).toThrow(
            'file system provider for scheme "mem" is already registered',
        );

        registration.dispose();
        registration.dispose();
        expect(files.hasProvider(mem("/a"))).toBe(false);
        expect(seen).toEqual([
            { scheme: "mem", added: true },
            { scheme: "mem", added: false },
        ]);
    });

    it("повторное снятие старой регистрации не трогает перерегистрированную схему", () => {
        const files = disposables.add(new FileService());
        const first = files.registerProvider("mem", new InMemoryFileSystemProvider());
        first.dispose();
        const second = disposables.add(files.registerProvider("mem", new InMemoryFileSystemProvider()));
        first.dispose();
        expect(files.hasProvider(mem("/a"))).toBe(true);
        second.dispose();
    });

    it("hasCapability смотрит на флаги провайдера схемы", () => {
        const { files } = setup(FileSystemProviderCapabilities.Readonly | FileSystemProviderCapabilities.Trash);
        expect(files.hasCapability(mem("/a"), FileSystemProviderCapabilities.Trash)).toBe(true);
        expect(files.hasCapability(mem("/a"), FileSystemProviderCapabilities.FileAtomicWrite)).toBe(false);
        expect(files.hasCapability(Uri.file("/a"), FileSystemProviderCapabilities.Trash)).toBe(false);
    });

    it("изменения провайдеров агрегируются; пустые не будят; снятая регистрация замолкает", () => {
        const files = disposables.add(new FileService());
        const changes = new Emitter<readonly Uri[]>();
        const registration = files.registerProvider("git", readonlyProvider({}, changes));
        const seen: (readonly Uri[])[] = [];
        disposables.add(files.onDidFilesChange((uris) => seen.push(uris)));
        const uri = Uri.from({ scheme: "git", path: "/a" });

        changes.fire([]);
        changes.fire([uri]);
        registration.dispose();
        changes.fire([uri]);
        expect(seen).toEqual([[uri]]);
    });
});

describe("FileService — чтение", () => {
    it("readFile отдаёт содержимое вместе с метаданными", async () => {
        const { files } = setup();
        await files.writeFile(mem("/a.txt"), bytes("hello"));
        const content = await files.readFile(mem("/a.txt"));
        expect(text(content.value)).toBe("hello");
        expect(content.name).toBe("a.txt");
        expect(content.size).toBe(5);
        expect(content.isFile).toBe(true);
        expect(content.isDirectory).toBe(false);
        expect(content.isSymbolicLink).toBe(false);
        expect(content.etag).toBe(etag(content));
        expect(content.resource.toString()).toBe(mem("/a.txt").toString());
    });

    it("каталог и файл больше потолка не читаются", async () => {
        const { files, provider } = setup();
        await files.createFolder(mem("/dir"));
        await files.writeFile(mem("/big.txt"), bytes("12345"));
        const read = vi.spyOn(provider, "readFile");

        const dir = await rejection(files.readFile(mem("/dir")));
        expect(isFileOperationError(dir, FileOperationResult.IsDirectory)).toBe(true);
        expect((dir as Error).message).toBe("'mem:/dir' is a directory");

        const big = await rejection(files.readFile(mem("/big.txt"), { limit: 4 }));
        expect(isFileOperationError(big, FileOperationResult.TooLarge)).toBe(true);
        expect((big as Error).message).toBe("'mem:/big.txt' is too large (5 > 4 bytes)");
        expect(read).not.toHaveBeenCalled();

        expect(text((await files.readFile(mem("/big.txt"), { limit: 5 })).value)).toBe("12345");
    });

    it("провайдер без stat: метаданные из содержимого, потолок — после чтения", async () => {
        const files = disposables.add(new FileService());
        disposables.add(files.registerProvider("git", readonlyProvider({ "/a": "abc" })));
        const uri = Uri.from({ scheme: "git", path: "/a" });

        const content = await files.readFile(uri);
        expect(text(content.value)).toBe("abc");
        expect(content.size).toBe(3);
        expect(content.mtime).toBe(0);
        expect(content.isFile).toBe(true);

        expect(
            isFileOperationError(await rejection(files.readFile(uri, { limit: 2 })), FileOperationResult.TooLarge),
        ).toBe(true);
        // stat у такого провайдера нет — exists отвечает «нет», а не бросает.
        expect(await files.exists(uri)).toBe(false);
        const statError = await rejection(files.stat(uri));
        expect(isFileOperationError(statError, FileOperationResult.Unavailable)).toBe(true);
        expect((statError as Error).message).toBe("'stat' is not supported for 'git:/a'");
    });

    it("схема без провайдера — отказ Unavailable", async () => {
        const files = disposables.add(new FileService());
        const error = await rejection(files.readFile(Uri.from({ scheme: "nope", path: "/a" })));
        expect(isFileOperationError(error, FileOperationResult.Unavailable)).toBe(true);
        expect((error as Error).message).toBe('no file system provider for scheme "nope"');
    });

    it("exists и stat", async () => {
        const { files } = setup();
        await files.createFolder(mem("/dir"));
        expect(await files.exists(mem("/dir"))).toBe(true);
        expect(await files.exists(mem("/missing"))).toBe(false);
        const stat = await files.stat(mem("/dir"));
        expect(stat.isDirectory).toBe(true);
        expect(stat.isFile).toBe(false);
        expect(stat.name).toBe("dir");
    });

    it("resolve: каталог с детьми, файл — без", async () => {
        const { files } = setup();
        await files.createFolder(mem("/dir/sub"));
        await files.writeFile(mem("/dir/a.txt"), bytes("a"));

        const dir = await files.resolve(mem("/dir"));
        expect(dir.isDirectory).toBe(true);
        expect(dir.children.map((c) => [c.name, c.type, c.resource.path]).sort()).toEqual([
            ["a.txt", FileType.File, "/dir/a.txt"],
            ["sub", FileType.Directory, "/dir/sub"],
        ]);

        const file = await files.resolve(mem("/dir/a.txt"));
        expect(file.children).toEqual([]);
    });

    it("resolve каталога без readdir у провайдера — отказ", async () => {
        const files = disposables.add(new FileService());
        disposables.add(
            files.registerProvider("x", {
                capabilities: FileSystemProviderCapabilities.None,
                onDidChangeFile: Event.None,
                readFile: () => Promise.resolve(bytes("")),
                stat: () => Promise.resolve({ type: FileType.Directory, mtime: 1, size: 0 }),
            }),
        );
        const error = await rejection(files.resolve(Uri.from({ scheme: "x", path: "/d" })));
        expect(isFileOperationError(error, FileOperationResult.Unavailable)).toBe(true);
        expect((error as Error).message).toBe("'readdir' is not supported for 'x:/d'");
    });
});

describe("FileService — запись", () => {
    it("writeFile: Create для нового, Write для существующего; отдаёт stat записанного", async () => {
        const { files, operations } = setup();
        const created = await files.writeFile(mem("/a.txt"), bytes("one"));
        expect(created.size).toBe(3);
        const written = await files.writeFile(mem("/a.txt"), bytes("three"));
        expect(written.size).toBe(5);
        expect(written.etag).not.toBe(created.etag);
        expect(operations.map((o) => [o.operation, o.resource.path])).toEqual([
            [FileOperation.Create, "/a.txt"],
            [FileOperation.Write, "/a.txt"],
        ]);
    });

    it("гард грязной записи: устаревший etag — отказ ModifiedSince, актуальный — запись", async () => {
        const { files } = setup();
        const first = await files.writeFile(mem("/a.txt"), bytes("one"));
        await files.writeFile(mem("/a.txt"), bytes("two"));

        const error = await rejection(files.writeFile(mem("/a.txt"), bytes("mine"), { etag: first.etag }));
        expect(isFileOperationError(error, FileOperationResult.ModifiedSince)).toBe(true);
        expect((error as Error).message).toBe("'mem:/a.txt' was modified on disk since it was read");
        expect(text((await files.readFile(mem("/a.txt"))).value)).toBe("two");

        const current = await files.stat(mem("/a.txt"));
        await files.writeFile(mem("/a.txt"), bytes("mine"), { etag: current.etag });
        expect(text((await files.readFile(mem("/a.txt"))).value)).toBe("mine");
        // Нового файла гард не касается: сравнивать не с чем.
        await files.writeFile(mem("/new.txt"), bytes("x"), { etag: "stale" });
    });

    it("atomic доходит до провайдера, только если тот умеет атомарную запись", async () => {
        for (const [capabilities, expected] of [
            [FileSystemProviderCapabilities.FileAtomicWrite, true],
            [FileSystemProviderCapabilities.None, false],
        ] as const) {
            const { files, provider } = setup(capabilities);
            const write = vi.spyOn(provider, "writeFile");
            await files.writeFile(mem("/a.txt"), bytes("x"), { atomic: true });
            await files.writeFile(mem("/a.txt"), bytes("y"));
            expect(write.mock.calls.map((c) => c[2])).toEqual([{ atomic: expected }, { atomic: false }]);
        }
    });

    it("записи в один ресурс идут по очереди, даже если предыдущая упала", async () => {
        const { files, provider } = setup();
        const log: string[] = [];
        const write = provider.writeFile.bind(provider);
        let releaseFirst!: () => void;
        const gate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        vi.spyOn(provider, "writeFile").mockImplementation(async (uri, content) => {
            const value = text(content);
            log.push(`start ${value}`);
            if (value === "first") {
                await gate;
                log.push("fail first");
                throw new Error("boom");
            }
            await write(uri, content);
            log.push(`end ${value}`);
        });

        const first = files.writeFile(mem("/a.txt"), bytes("first"));
        const second = files.writeFile(mem("/a.txt"), bytes("second"));
        const other = files.writeFile(mem("/b.txt"), bytes("other"));
        await other;
        expect(log).toEqual(["start first", "start other", "end other"]);

        releaseFirst();
        await expect(first).rejects.toThrow("boom");
        await second;
        expect(log).toEqual(["start first", "start other", "end other", "fail first", "start second", "end second"]);
        expect(text((await files.readFile(mem("/a.txt"))).value)).toBe("second");
    });

    it("только-для-чтения провайдер отказывает в записи, создании, удалении и переносе", async () => {
        const { files } = setup(FileSystemProviderCapabilities.Readonly);
        for (const [operation, attempt] of [
            ["writeFile", files.writeFile(mem("/a"), bytes(""))],
            ["mkdir", files.createFolder(mem("/a"))],
            ["delete", files.del(mem("/a"))],
            ["rename", files.move(mem("/a"), mem("/b"))],
            ["copy", files.copy(mem("/a"), mem("/b"))],
        ] as const) {
            const error = await rejection(attempt);
            expect(isFileOperationError(error, FileOperationResult.PermissionDenied)).toBe(true);
            expect((error as Error).message).toBe(`cannot ${operation} 'mem:/a': the file system is read-only`);
        }
    });

    it("операции, которых провайдер не умеет, — отказ Unavailable", async () => {
        const files = disposables.add(new FileService());
        disposables.add(
            files.registerProvider("x", {
                capabilities: FileSystemProviderCapabilities.None,
                onDidChangeFile: Event.None,
                readFile: () => Promise.resolve(bytes("")),
            }),
        );
        const x = (path: string): Uri => Uri.from({ scheme: "x", path });
        for (const [operation, attempt] of [
            ["writeFile", files.writeFile(x("/a"), bytes(""))],
            ["mkdir", files.createFolder(x("/a"))],
            ["delete", files.del(x("/a"))],
            ["rename", files.move(x("/a"), x("/b"))],
            ["copy", files.copy(x("/a"), x("/b"))],
        ] as const) {
            const error = await rejection(attempt);
            expect(isFileOperationError(error, FileOperationResult.Unavailable)).toBe(true);
            expect((error as Error).message).toBe(`'${operation}' is not supported for 'x:/a'`);
        }
    });

    it("ошибка stat перед записью (кроме «нет файла») не глотается — запись не идёт", async () => {
        const { files, provider } = setup();
        vi.spyOn(provider, "stat").mockRejectedValueOnce(new Error("EIO"));
        await expect(files.writeFile(mem("/a"), bytes("x"))).rejects.toThrow("EIO");
        expect(await files.exists(mem("/a"))).toBe(false);
    });

    it("провайдер, умеющий писать, но без stat, — запись недоступна", async () => {
        const files = disposables.add(new FileService());
        const writeFile = vi.fn(() => Promise.resolve());
        disposables.add(
            files.registerProvider("x", {
                capabilities: FileSystemProviderCapabilities.None,
                onDidChangeFile: Event.None,
                readFile: () => Promise.resolve(bytes("")),
                writeFile,
            }),
        );
        const error = await rejection(files.writeFile(Uri.from({ scheme: "x", path: "/a" }), bytes("")));
        expect(isFileOperationError(error, FileOperationResult.Unavailable)).toBe(true);
        expect(writeFile).not.toHaveBeenCalled();
    });

    it("createFolder создаёт с родителями и сообщает Create", async () => {
        const { files, operations } = setup();
        await files.createFolder(mem("/a/b/c"));
        expect((await files.stat(mem("/a/b"))).isDirectory).toBe(true);
        expect(operations).toEqual([{ operation: FileOperation.Create, resource: mem("/a/b/c") }]);
    });

    it("del: рекурсивно по просьбе, корзина — только у провайдера с корзиной", async () => {
        const { files, provider, operations } = setup();
        await files.createFolder(mem("/d/sub"));
        const del = vi.spyOn(provider, "delete");

        await expect(files.del(mem("/d"))).rejects.toThrow("'/d' is not empty");
        await files.del(mem("/d"), { recursive: true });
        expect(await files.exists(mem("/d"))).toBe(false);
        expect(del.mock.calls.map((c) => c[1])).toEqual([
            { recursive: false, useTrash: false },
            { recursive: true, useTrash: false },
        ]);
        expect(operations.at(-1)).toEqual({ operation: FileOperation.Delete, resource: mem("/d") });

        const error = await rejection(files.del(mem("/x"), { useTrash: true }));
        expect(isFileOperationError(error, FileOperationResult.Unavailable)).toBe(true);
        expect((error as Error).message).toBe("'trash' is not supported for 'mem:/x'");

        const trash = setup(FileSystemProviderCapabilities.Trash);
        await trash.files.writeFile(mem("/t"), bytes(""));
        const trashDelete = vi.spyOn(trash.provider, "delete");
        await trash.files.del(mem("/t"), { useTrash: true });
        expect(trashDelete.mock.calls[0][1]).toEqual({ recursive: false, useTrash: true });
    });

    it("move и copy: внутри схемы, с переписыванием по просьбе; межсхемные — отказ", async () => {
        const { files, operations } = setup();
        await files.writeFile(mem("/a"), bytes("a"));
        await files.writeFile(mem("/b"), bytes("b"));

        expect(
            isFileOperationError(await rejection(files.move(mem("/a"), mem("/b"))), FileOperationResult.Exists),
        ).toBe(true);
        expect(
            isFileOperationError(await rejection(files.copy(mem("/a"), mem("/b"))), FileOperationResult.Exists),
        ).toBe(true);
        await files.copy(mem("/a"), mem("/c"));
        await files.move(mem("/a"), mem("/b"), true);
        await files.copy(mem("/b"), mem("/c"), true);
        expect(await files.exists(mem("/a"))).toBe(false);
        expect(text((await files.readFile(mem("/c"))).value)).toBe("a");
        expect(operations.slice(-3)).toEqual([
            { operation: FileOperation.Copy, resource: mem("/a"), target: mem("/c") },
            { operation: FileOperation.Move, resource: mem("/a"), target: mem("/b") },
            { operation: FileOperation.Copy, resource: mem("/b"), target: mem("/c") },
        ]);

        const other = Uri.from({ scheme: "other", path: "/b" });
        for (const [operation, attempt] of [
            ["rename", files.move(mem("/b"), other)],
            ["copy", files.copy(mem("/b"), other)],
        ] as const) {
            const error = await rejection(attempt);
            expect(isFileOperationError(error, FileOperationResult.Unavailable)).toBe(true);
            expect((error as Error).message).toBe(`'${operation}' is not supported for 'other:/b'`);
        }
    });

    it("FileOperationError несёт код и имя", () => {
        const error = new FileOperationError("x", FileOperationResult.Exists);
        expect(error.name).toBe("FileOperationError");
        expect(error.result).toBe(FileOperationResult.Exists);
        expect(isFileOperationError(error, FileOperationResult.NotFound)).toBe(false);
        expect(isFileOperationError(new Error("x"), FileOperationResult.Exists)).toBe(false);
    });

    it("etag — время изменения и размер в форме эталона", () => {
        expect(etag({ mtime: 1000, size: 31 })).toBe("15e10");
    });
});
