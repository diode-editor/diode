import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import type { IFileWatcher } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import type { TextFileModel } from "./textFileModel.ts";
import { TextFileModelService } from "./textFileModelService.ts";

/**
 * Модели вне вкладок: реестр файлов, сквозная нумерация безымянных, пайплайн
 * сохранения и агрегатное событие save.
 */
describe("TextFileModelService", () => {
    let ws: ITempWorkspace;
    let service: TextFileModelService;

    function createService(watcher: IFileWatcher = NULL_FILE_WATCHER): TextFileModelService {
        return new TextFileModelService(NULL_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService(), watcher);
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-model-service-" });
        service = createService();
    });

    afterEach(() => {
        service.dispose();
        ws.dispose();
    });

    it("файл — одна модель на ресурс, get не создаёт и не держит ссылку", () => {
        const uri = Uri.file(ws.writeFile("a.txt", "alpha"));
        expect(service.get(uri)).toBeNull();

        const first = service.acquire(uri);
        const second = service.acquire(uri);

        expect(second.model).toBe(first.model);
        expect(service.get(uri)).toBe(first.model);
        expect(first.model.getText()).toBe("alpha");
        first.dispose();
        second.dispose();
        expect(service.get(uri)).toBeNull();
    });

    it("безымянные буферы нумеруются сквозь весь сервис", () => {
        const a = service.createUntitledModel();
        const b = service.createUntitledModel();

        expect([a.uri.toString(), b.uri.toString()]).toEqual(["untitled:Untitled-1", "untitled:Untitled-2"]);
        a.dispose();
        b.dispose();
    });

    it("безымянный буфер обвязан, как файл: Save As объявляет сохранение", async () => {
        const model = service.createUntitledModel();
        const saved: TextFileModel[] = [];
        service.onDidSaveModel((m) => saved.push(m));
        const target = ws.path("named.txt");

        await model.saveAs(target);

        expect(saved).toEqual([model]);
        model.dispose();
    });

    it("модель файла сразу под наблюдением watcher'а", () => {
        const watched: string[] = [];
        const watcher: IFileWatcher = {
            ...NULL_FILE_WATCHER,
            watchFile: (path) => {
                watched.push(path);
                return { dispose: () => {} };
            },
        };
        const watching = createService(watcher);
        const path = ws.writeFile("w.txt", "x");

        const ref = watching.acquire(Uri.file(path));

        expect(watched).toEqual([path]);
        ref.dispose();
        watching.dispose();
    });

    it("участники сохранения — в порядке регистрации; null пропускается, снятый не зовётся", async () => {
        const calls: string[] = [];
        const participant = (name: string) => () => {
            calls.push(name);
            return Promise.resolve([]);
        };
        const removed = service.addSaveParticipant(() => participant("removed"));
        service.addSaveParticipant(() => participant("first"));
        service.addSaveParticipant(() => null);
        service.addSaveParticipant(() => participant("last"));
        removed.dispose();
        // Повторное снятие — no-op: соседей не трогает.
        removed.dispose();
        const ref = service.acquire(Uri.file(ws.writeFile("s.txt", "x")));
        ref.model.attachEditTarget({
            cloneSelections: () => [],
            applyEdits: () => undefined,
            markDirty: () => {},
        });

        await ref.model.save();

        expect(calls).toEqual(["first", "last"]);
        ref.dispose();
    });

    it("onDidSaveModel — после перепривязки ключа реестра на новый путь", async () => {
        const oldPath = ws.writeFile("old.txt", "x");
        const ref = service.acquire(Uri.file(oldPath));
        const newPath = ws.path("new.txt");
        const seen: { model: TextFileModel; registered: TextFileModel | null }[] = [];
        service.onDidSaveModel((model) => {
            seen.push({ model, registered: service.get(Uri.file(newPath)) });
        });

        await ref.model.saveAs(newPath);

        expect(fs.readFileSync(newPath, "utf8")).toBe("x");
        expect(seen).toHaveLength(1);
        expect(seen[0].model).toBe(ref.model);
        expect(seen[0].registered).toBe(ref.model);
        ref.dispose();
    });
});
