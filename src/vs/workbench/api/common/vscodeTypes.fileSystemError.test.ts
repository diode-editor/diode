import { describe, expect, it } from "vitest";

import { FileSystemError, Uri } from "./vscodeTypes.ts";

describe("FileSystemError", () => {
    it("factories set the matching code", () => {
        expect(FileSystemError.FileNotFound("m").code).toBe("FileNotFound");
        expect(FileSystemError.FileExists("m").code).toBe("FileExists");
        expect(FileSystemError.NoPermissions("m").code).toBe("NoPermissions");
        expect(FileSystemError.Unavailable("m").code).toBe("Unavailable");
    });

    it("FileNotADirectory/FileIsADirectory factories (declared in d.ts) set code and provider name", () => {
        const notDir = FileSystemError.FileNotADirectory("m");
        expect(notDir.code).toBe("FileNotADirectory");
        expect(notDir.name).toBe("EntryNotADirectory (FileSystemError)");
        expect(notDir.message).toBe("m");
        const isDir = FileSystemError.FileIsADirectory(Uri.file("/a/dir"));
        expect(isDir.code).toBe("FileIsADirectory");
        expect(isDir.name).toBe("EntryIsADirectory (FileSystemError)");
        expect(isDir.message).toContain("/a/dir");
    });

    it("is an Error with a VS Code-compatible name (provider code + suffix)", () => {
        const err = FileSystemError.FileNotFound("nope");
        expect(err).toBeInstanceOf(Error);
        // The stock editorconfig-vscode extension matches FileNotFound by exactly this name.
        expect(err.name).toBe("EntryNotFound (FileSystemError)");
        expect(err.code).toBe("FileNotFound");
        expect(err.message).toBe("nope");
    });

    it("names of other codes are also in VS Code format", () => {
        expect(FileSystemError.FileExists("m").name).toBe("EntryExists (FileSystemError)");
        expect(FileSystemError.NoPermissions("m").name).toBe("NoPermissions (FileSystemError)");
        expect(new FileSystemError().name).toBe("Unknown (FileSystemError)");
        expect(new FileSystemError("m", "Custom").name).toBe("Custom (FileSystemError)");
    });

    it("accepts a Uri (message from toString) and an empty constructor (code=Unknown)", () => {
        const fromUri = FileSystemError.FileExists(Uri.file("/a/b.txt"));
        expect(fromUri.message).toContain("/a/b.txt");
        const bare = new FileSystemError();
        expect(bare.code).toBe("Unknown");
        expect(bare.message).toBe("");
    });
});
