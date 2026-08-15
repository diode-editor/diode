import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";

import { DiskFileSystemProvider } from "./diskFileSystemProvider.ts";

describe("DiskFileSystemProvider", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-diskfs-"));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("reads file contents from disk", async () => {
        const file = path.join(dir, "a.txt");
        fs.writeFileSync(file, "привет, диск");

        const provider = new DiskFileSystemProvider();
        const bytes = await provider.readFile(Uri.file(file));

        expect(new TextDecoder().decode(bytes)).toBe("привет, диск");
    });

    it("rejects for a missing file (FileNotFound semantics)", async () => {
        const provider = new DiskFileSystemProvider();
        await expect(provider.readFile(Uri.file(path.join(dir, "missing.txt")))).rejects.toThrow();
    });

    it("onDidChangeFile is a no-op subscription", () => {
        const provider = new DiskFileSystemProvider();
        expect(() => provider.onDidChangeFile().dispose()).not.toThrow();
    });
});
