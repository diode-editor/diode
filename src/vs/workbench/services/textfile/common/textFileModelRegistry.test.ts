import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
        ws = createTempWorkspace({ prefix: "vexx-model-registry-" });
        undoRedo = new UndoRedoService();
        created = [];
        registry = new TextFileModelRegistry((uri) => {
            const model = new TextFileModel(NULL_LANGUAGE_SERVICE, undoRedo);
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

    it("двойной acquire одного ресурса отдаёт одну и ту же модель", () => {
        const uri = fileUri("a.txt");
        const refA = registry.acquire(uri);
        const refB = registry.acquire(uri);

        expect(refA.model === refB.model).toBe(true);
        expect(created.length).toBe(1);
        expect(registry.refCount(uri)).toBe(2);
    });

    it("модель живёт до освобождения последней ссылки и умирает с ней", () => {
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

    it("повторный dispose одной ссылки — no-op (не крадёт чужой ref)", () => {
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

    it("освобождение последней ссылки чистит undo-бакет модели (штатный dispose)", () => {
        const uri = fileUri("a.txt", "hello");
        const ref = registry.acquire(uri);
        const context = ref.model.undoContext;
        undoRedo.pushElement({ label: "step", resources: [], undo: () => {}, redo: () => {} }, context);
        expect(undoRedo.peekUndo(context)).toBeDefined();

        ref.dispose();

        expect(undoRedo.peekUndo(context)).toBeUndefined();
    });

    it("после acquire нового ресурса создаётся отдельная модель", () => {
        const refA = registry.acquire(fileUri("a.txt"));
        const refB = registry.acquire(fileUri("b.txt"));

        expect(refA.model === refB.model).toBe(false);
        expect(registry.models().length).toBe(2);
    });

    it("handleUriChanged перепривязывает ключ после saveAs", async () => {
        const uri = fileUri("a.txt", "text");
        const ref = registry.acquire(uri);
        const newPath = ws.path("renamed.txt");

        await ref.model.saveAs(newPath);
        registry.handleUriChanged(ref.model);

        // Повторное открытие нового пути попадает в ту же модель…
        const refNew = registry.acquire(Uri.file(newPath));
        expect(refNew.model === ref.model).toBe(true);
        // …а старый ключ свободен: свежая модель, не та же.
        const refOld = registry.acquire(uri);
        expect(refOld.model === ref.model).toBe(false);
    });

    it("коллизия ключей при saveAs оставляет перемещённую модель без ключа, ссылки живы", async () => {
        const uriA = fileUri("a.txt", "aaa");
        const uriB = fileUri("b.txt", "bbb");
        const refA = registry.acquire(uriA);
        const refB = registry.acquire(uriB);

        // A сохраняется поверх пути B — ключ b.txt уже занят моделью B.
        await refA.model.saveAs(uriB.fsPath);
        registry.handleUriChanged(refA.model);

        // Лукап отдаёт модель-владельца ключа, а не перемещённую.
        expect(registry.get(uriB) === refB.model).toBe(true);
        // Перемещённая модель осталась живой и корректно освобождается.
        const disposeSpy = vi.spyOn(refA.model, "dispose");
        refA.dispose();
        expect(disposeSpy).toHaveBeenCalledTimes(1);
        refB.dispose();
    });
});
