import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { settle } from "../../../../../TestUtils/timing.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import type { IProviderWriteOptions } from "../../../../platform/files/common/files.ts";
import { FileService } from "../../../../platform/files/common/fileService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { InMemoryFileSystemProvider } from "../../../../platform/files/common/inMemoryFileSystemProvider.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import type { TextFileModel } from "./textFileModel.ts";
import { TextFileModelService } from "./textFileModelService.ts";

// A resource of a writable FS provider (`_claude_fs_right:` in Claude Code) is a shared model like
// a file; our own write does not wipe the undo history.

/** Like the Claude Code provider, reports every write. */
class ChangeFiringProvider extends InMemoryFileSystemProvider {
    private readonly changes = new Emitter<readonly Uri[]>();
    public override readonly onDidChangeFile = this.changes.event;
    public writes = 0;
    public failReads = false;
    public hold: Promise<void> | null = null;

    public override async writeFile(resource: Uri, content: Uint8Array, options?: IProviderWriteOptions) {
        this.writes++;
        await this.writeSilently(resource, content, options);
        this.fireChange([resource]);
    }

    public writeSilently(resource: Uri, content: Uint8Array, options?: IProviderWriteOptions): Promise<void> {
        return super.writeFile(resource, content, options);
    }

    public fireChange(uris: readonly Uri[]): void {
        this.changes.fire(uris);
    }

    public override async readFile(resource: Uri): Promise<Uint8Array> {
        if (this.failReads) throw new Error("read failed");
        const hold = this.hold;
        const bytes = await super.readFile(resource);
        if (hold !== null) await hold;
        return bytes;
    }
}

const SCHEME = "_claude_fs_right";
const right = Uri.from({ scheme: SCHEME, path: "/a.ts" });
const encode = (text: string) => new TextEncoder().encode(text);

describe("TextFileModel — file system provider resource", () => {
    let provider: ChangeFiringProvider;
    let files: FileService;
    let service: TextFileModelService;

    beforeEach(async () => {
        provider = new ChangeFiringProvider();
        files = new FileService();
        files.registerProvider(SCHEME, provider);
        await provider.writeFile(right, encode("proposed\n"));
        provider.writes = 0;
        service = new TextFileModelService(NULL_LANGUAGE_SERVICE, new UndoRedoService(), files, NULL_FILE_WATCHER);
    });

    afterEach(() => {
        service.dispose();
    });

    async function open(): Promise<TextFileModel> {
        return (await service.acquireProvided(right)).model;
    }

    it("opens with the provider text, uri is the resource itself, the buffer is clean", async () => {
        const model = await open();

        expect(model.uri.toString()).toBe(right.toString());
        expect(model.getText()).toBe("proposed\n");
        expect(model.isModified).toBe(false);
    });

    it("one model per resource; the first open reads, a repeated one does not", async () => {
        const first = await service.acquireProvided(right);
        await provider.writeFile(right, encode("changed under us\n"));
        await settle();
        provider.failReads = true;
        const second = await service.acquireProvided(right);

        expect(second.model).toBe(first.model);
        expect(service.get(right)).toBe(first.model);
        first.dispose();
        second.dispose();
        expect(service.get(right)).toBeNull();
    });

    it("save writes to the provider through participants and clears dirty", async () => {
        const model = await open();
        const participated: string[] = [];
        service.addSaveParticipant(() => (m) => {
            participated.push(m.uri);
            return Promise.resolve([]);
        });
        const saved: TextFileModel[] = [];
        service.onDidSaveModel((m) => saved.push(m));

        model.restoreUnsavedContents("edited\n");
        expect(model.isModified).toBe(true);
        await expect(model.save()).resolves.toBe("saved");

        expect(new TextDecoder().decode(await provider.readFile(right))).toBe("edited\n");
        expect(participated).toEqual([right.toString()]);
        expect(saved).toEqual([model]);
        expect(model.isModified).toBe(false);
    });

    it("our own write does not reread the buffer, the undo history is intact", async () => {
        const model = await open();
        model.restoreUnsavedContents("edited\n");
        // A reload replaces the whole text: a new document version and a history reset.
        const version = model.document.versionId;

        let diskEvents = 0;
        model.onDidChangeDiskState(() => diskEvents++);

        await model.save();
        await settle();

        expect(provider.writes).toBe(1);
        expect(diskEvents).toBe(0);
        expect(model.document.versionId).toBe(version);
        expect(model.getText()).toBe("edited\n");
        expect(model.hasDiskConflict).toBe(false);
    });

    it("a clean buffer is reread when the provider rewrites the resource", async () => {
        const model = await open();
        let diskEvents = 0;
        model.onDidChangeDiskState(() => diskEvents++);

        await provider.writeFile(right, encode("re-proposed\n"));
        await settle();

        expect(model.getText()).toBe("re-proposed\n");
        expect(model.isModified).toBe(false);
        expect(diskEvents).toBe(1);
    });

    it("a dirty buffer is left alone and a conflict is raised; save writes and clears it", async () => {
        const model = await open();
        model.restoreUnsavedContents("mine\n");

        await provider.writeFile(right, encode("theirs\n"));
        await settle();

        expect(model.getText()).toBe("mine\n");
        expect(model.hasDiskConflict).toBe(true);
        await expect(model.save()).resolves.toBe("saved");
        expect(new TextDecoder().decode(await provider.readFile(right))).toBe("mine\n");
        expect(model.hasDiskConflict).toBe(false);
    });

    it("a change to another resource of the same scheme does not wake the model", async () => {
        const model = await open();
        const other = Uri.from({ scheme: SCHEME, path: "/b.ts" });
        // Our resource changed too, but the provider did not report it.
        await provider.writeSilently(right, encode("silently\n"));

        await provider.writeFile(other, encode("other\n"));
        await settle();

        expect(model.getText()).toBe("proposed\n");
    });

    it("an event about several resources including ours triggers a reread", async () => {
        const model = await open();
        await provider.writeSilently(right, encode("batched\n"));

        provider.fireChange([Uri.from({ scheme: SCHEME, path: "/b.ts" }), right]);
        await settle();

        expect(model.getText()).toBe("batched\n");
    });

    it("encoding comes from the BOM, language from the resource path", async () => {
        await provider.writeFile(right, new Uint8Array([0xef, 0xbb, 0xbf, ...encode("bom\n")]));
        const languages = {
            ...NULL_LANGUAGE_SERVICE,
            getLanguageIdForResource: (path: string) => (path.endsWith(".ts") ? "typescript" : undefined),
        };
        const typed = new TextFileModelService(languages, new UndoRedoService(), files, NULL_FILE_WATCHER);
        const { model } = await typed.acquireProvided(right);

        expect(model.getText()).toBe("bom\n");
        expect(model.encoding).toBe("utf8bom");
        expect(model.languageId).toBe("typescript");
        typed.dispose();
    });

    it("a resource unreadable on reread leaves the buffer as is, no rejection outside", async () => {
        const model = await open();
        const rejections: unknown[] = [];
        const onRejection = (reason: unknown) => rejections.push(reason);
        process.on("unhandledRejection", onRejection);
        provider.failReads = true;

        try {
            provider.fireChange([right]);
            await settle(10);
        } finally {
            process.off("unhandledRejection", onRejection);
        }

        expect(rejections).toEqual([]);
        expect(model.getText()).toBe("proposed\n");
        expect(model.hasDiskConflict).toBe(false);
    });

    it("a slow reread does not overwrite a later one", async () => {
        const model = await open();
        let release = () => {};
        provider.hold = new Promise((resolve) => (release = resolve));
        await provider.writeSilently(right, encode("older\n"));
        provider.fireChange([right]);
        await settle();
        provider.hold = null;

        await provider.writeFile(right, encode("newer\n"));
        await settle();
        release();
        await settle();

        expect(model.getText()).toBe("newer\n");
    });

    it("after a reread, save is not blocked by the snapshot of the previous write", async () => {
        const model = await open();
        model.restoreUnsavedContents("first\n");
        await model.save();
        await provider.writeFile(right, encode("rewritten by the extension\n"));
        await settle();
        expect(model.getText()).toBe("rewritten by the extension\n");

        model.restoreUnsavedContents("second\n");

        await expect(model.save()).resolves.toBe("saved");
        expect(new TextDecoder().decode(await provider.readFile(right))).toBe("second\n");
    });

    it("a closed provider model no longer listens", async () => {
        const ref = await service.acquireProvided(right);
        const model = ref.model;
        ref.dispose();

        await provider.writeFile(right, encode("after close\n"));
        await settle();

        expect(model.getText()).toBe("proposed\n");
    });

    it("an unreadable resource rejects, no model appears", async () => {
        const missing = Uri.from({ scheme: SCHEME, path: "/missing.ts" });

        await expect(service.acquireProvided(missing)).rejects.toThrow();
        expect(service.get(missing)).toBeNull();
    });

    it("openProvided rejects file: and untitled:, they have their own paths", () => {
        const model = service.createUntitledModel();
        expect(() => {
            model.openProvided(Uri.file("/a.ts"), encode(""));
        }).toThrow(/expected a provider resource, got file:/);
        expect(() => {
            model.openProvided(Uri.from({ scheme: "untitled", path: "x" }), encode(""));
        }).toThrow(/got untitled:/);
        model.dispose();
    });
});
