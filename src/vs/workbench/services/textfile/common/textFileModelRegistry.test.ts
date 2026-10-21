import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import { TextFileModel } from "./textFileModel.ts";
import { TextFileModelRegistry } from "./textFileModelRegistry.ts";

describe("TextFileModelRegistry", () => {
    let ws: ITempWorkspace;
    let undoRedo: UndoRedoService;
    let registry: TextFileModelRegistry;
    let created: TextFileModel[];

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-model-registry-" });
        undoRedo = new UndoRedoService();
        created = [];
        registry = new TextFileModelRegistry((uri) => {
            const model = new TextFileModel(NULL_LANGUAGE_SERVICE, undoRedo, diskFileService());
            model.openFile(uri);
            created.push(model);
            return model;
        });
    });

    afterEach(() => {
        ws.dispose();
    });

    function fileUri(name: string, content = "content"): Uri {
        return Uri.file(ws.writeFile(name, content));
    }

    it("acquiring the same resource twice returns the same model", () => {
        const uri = fileUri("a.txt");
        const refA = registry.acquire(uri);
        const refB = registry.acquire(uri);

        expect(refA.model === refB.model).toBe(true);
        expect(created.length).toBe(1);
        expect(registry.refCount(uri)).toBe(2);
    });

    it("the model lives until the last reference is released and dies with it", () => {
        const uri = fileUri("a.txt");
        const refA = registry.acquire(uri);
        const refB = registry.acquire(uri);
        const disposeSpy = vi.spyOn(refA.model, "dispose");

        refA.dispose();
        expect(disposeSpy).not.toHaveBeenCalled();
        expect(registry.refCount(uri)).toBe(1);
        expect(registry.get(uri) === refB.model).toBe(true);

        refB.dispose();
        expect(disposeSpy).toHaveBeenCalledTimes(1);
        expect(registry.refCount(uri)).toBe(0);
        expect(registry.get(uri)).toBeNull();
    });

    it("disposing one reference twice is a no-op (does not steal another ref)", () => {
        const uri = fileUri("a.txt");
        const refA = registry.acquire(uri);
        const refB = registry.acquire(uri);
        const disposeSpy = vi.spyOn(refA.model, "dispose");

        refA.dispose();
        refA.dispose();

        expect(disposeSpy).not.toHaveBeenCalled();
        expect(registry.refCount(uri)).toBe(1);
        refB.dispose();
        expect(disposeSpy).toHaveBeenCalledTimes(1);
    });

    it("releasing the last reference clears the model undo bucket (regular dispose)", () => {
        const uri = fileUri("a.txt", "hello");
        const ref = registry.acquire(uri);
        const context = ref.model.undoContext;
        undoRedo.pushElement({ label: "step", resources: [], undo: () => {}, redo: () => {} }, context);
        expect(undoRedo.peekUndo(context)).toBeDefined();

        ref.dispose();

        expect(undoRedo.peekUndo(context)).toBeUndefined();
    });

    it("acquiring a new resource creates a separate model", () => {
        const refA = registry.acquire(fileUri("a.txt"));
        const refB = registry.acquire(fileUri("b.txt"));

        expect(refA.model === refB.model).toBe(false);
        expect(registry.models().length).toBe(2);
    });

    it("handleUriChanged rebinds the key after saveAs", async () => {
        const uri = fileUri("a.txt", "text");
        const ref = registry.acquire(uri);
        const newPath = ws.path("renamed.txt");

        await ref.model.saveAs(newPath);
        registry.handleUriChanged(ref.model);

        const refNew = registry.acquire(Uri.file(newPath));
        expect(refNew.model === ref.model).toBe(true);
        const refOld = registry.acquire(uri);
        expect(refOld.model === ref.model).toBe(false);
    });

    it("a key collision on saveAs leaves the moved model without a key, references stay alive", async () => {
        const uriA = fileUri("a.txt", "aaa");
        const uriB = fileUri("b.txt", "bbb");
        const refA = registry.acquire(uriA);
        const refB = registry.acquire(uriB);

        // A is saved over path B, whose key b.txt is already taken by model B.
        await refA.model.saveAs(uriB.fsPath);
        registry.handleUriChanged(refA.model);

        expect(registry.get(uriB) === refB.model).toBe(true);
        const disposeSpy = vi.spyOn(refA.model, "dispose");
        refA.dispose();
        expect(disposeSpy).toHaveBeenCalledTimes(1);
        refB.dispose();
    });

    it("a keyless model (after a collision) moves to a free path and is indexed again", async () => {
        const uriA = fileUri("a.txt", "aaa");
        const uriB = fileUri("b.txt", "bbb");
        const refA = registry.acquire(uriA);
        const refB = registry.acquire(uriB);

        await refA.model.saveAs(uriB.fsPath);
        registry.handleUriChanged(refA.model);

        // The second move already has key === null: there is no old key to remove.
        const freePath = ws.path("c.txt");
        await refA.model.saveAs(freePath);
        registry.handleUriChanged(refA.model);

        expect(registry.get(Uri.file(freePath)) === refA.model).toBe(true);
        refA.dispose();
        refB.dispose();
    });
});
