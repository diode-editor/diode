import { describe, expect, it } from "vitest";

import { FileSystemError, Uri } from "./vscodeTypes.ts";

describe("FileSystemError", () => {
    it("фабрики выставляют соответствующий code", () => {
        expect(FileSystemError.FileNotFound("m").code).toBe("FileNotFound");
        expect(FileSystemError.FileExists("m").code).toBe("FileExists");
        expect(FileSystemError.NoPermissions("m").code).toBe("NoPermissions");
        expect(FileSystemError.Unavailable("m").code).toBe("Unavailable");
    });

    it("фабрики FileNotADirectory/FileIsADirectory (объявлены в d.ts) — code и провайдерный name", () => {
        const notDir = FileSystemError.FileNotADirectory("m");
        expect(notDir.code).toBe("FileNotADirectory");
        expect(notDir.name).toBe("EntryNotADirectory (FileSystemError)");
        expect(notDir.message).toBe("m");
        const isDir = FileSystemError.FileIsADirectory(Uri.file("/a/dir"));
        expect(isDir.code).toBe("FileIsADirectory");
        expect(isDir.name).toBe("EntryIsADirectory (FileSystemError)");
        expect(isDir.message).toContain("/a/dir");
    });

    it("это Error с VS Code-совместимым name (провайдерный код + суффикс)", () => {
        const err = FileSystemError.FileNotFound("nope");
        expect(err).toBeInstanceOf(Error);
        // VS Code выставляет name = "EntryNotFound (FileSystemError)" для FileNotFound;
        // стоковый editorconfig-vscode ловит именно по этому имени в EditorConfig.generate.
        expect(err.name).toBe("EntryNotFound (FileSystemError)");
        expect(err.code).toBe("FileNotFound");
        expect(err.message).toBe("nope");
    });

    it("name других кодов тоже в формате VS Code", () => {
        expect(FileSystemError.FileExists("m").name).toBe("EntryExists (FileSystemError)");
        expect(FileSystemError.NoPermissions("m").name).toBe("NoPermissions (FileSystemError)");
        expect(new FileSystemError().name).toBe("Unknown (FileSystemError)");
        // Код вне таблицы провайдерных имён — используется как есть.
        expect(new FileSystemError("m", "Custom").name).toBe("Custom (FileSystemError)");
    });

    it("принимает Uri (message из toString) и пустой конструктор (code=Unknown)", () => {
        const fromUri = FileSystemError.FileExists(Uri.file("/a/b.txt"));
        expect(fromUri.message).toContain("/a/b.txt");
        const bare = new FileSystemError();
        expect(bare.code).toBe("Unknown");
        expect(bare.message).toBe("");
    });
});
