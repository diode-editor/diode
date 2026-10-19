import * as fs from "node:fs";

import type { EditorTabStripElement } from "@tuidom/elements/editorgroup/editorTabStripElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { fileDialogDriver } from "../../../TestUtils/fileDialogDriver.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../base/common/uri.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

/** Вопрос о перезаписи — заголовок второго пикера диалога (эталон). */
const overwriteQuestion = (name: string): string => `${name} already exists. Are you sure you want to overwrite it?`;

describe("Workbench — Save As", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-saveas-",
            files: {
                "alpha.txt": "Alpha content",
                "beta.txt": "Beta content",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("диалог стоит на пути текущего файла, каталог файла — под строкой", async () => {
        const filePath = ws.path("alpha.txt");
        h.commands.execute("workbench.openFile", filePath);
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.saveAs");
        await dialog.settle({ title: "Save As", query: filePath, items: ["..", "alpha.txt", "beta.txt"] });
        // Имя без расширения выделено: набор заменит его, «.txt» останется.
        expect(dialog.component.view.inputElement.inputState.selectedText).toBe("alpha");
        dialog.key("Escape");
    });

    it("saves the active editor to a new path and renames the tab", async () => {
        const filePath = ws.path("alpha.txt");
        h.commands.execute("workbench.openFile", filePath);
        h.testApp.render();

        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.saveAs");
        await dialog.settle({ query: filePath });

        const newPath = ws.path("renamed.md");
        dialog.replaceQuery(newPath);
        await dialog.settle({ query: newPath });
        dialog.key("Enter");
        // Цель проверяется по диску асинхронно (файловый сервис).
        await vi.waitFor(() => {
            expect(fs.readFileSync(newPath, "utf-8")).toBe("Alpha content");
        });

        // Файл переехал на новый путь той же вкладкой — второй не появилось.
        // Ждём и метку: атомарная запись кладёт файл на диск раньше, чем
        // `writeFile` вернётся и модель объявит о сохранении (под нагрузкой —
        // заметно раньше), а вкладку переименовывает именно это событие.
        const tabStrip = h.testApp.querySelector("EditorTabStripElement") as EditorTabStripElement;
        await vi.waitFor(() => {
            h.testApp.render();
            const labels = tabStrip.getItemElements().map((el) => el.getLabel());
            expect(labels).toHaveLength(1);
            expect(labels.some((l) => l.includes("renamed.md"))).toBe(true);
        });
    });

    it("Save As в собственный путь — вопрос эталона о перезаписи, Enter сохраняет", async () => {
        const alphaPath = ws.path("alpha.txt");
        h.commands.execute("workbench.openFile", alphaPath);
        h.testApp.render();
        h.activeEditor().viewState.type("X");
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.saveAs");
        await dialog.settle({ query: alphaPath });

        dialog.key("Enter");
        await dialog.settle({ title: overwriteQuestion("alpha.txt") });
        dialog.key("Enter");
        await vi.waitFor(() => {
            expect(fs.readFileSync(alphaPath, "utf-8")).toBe("XAlpha content");
        });
    });

    it("Save As виртуального документа пишет копию и открывает её файлом; исходная вкладка остаётся", async () => {
        const service = h.container.get(EditorServiceDIToken);
        service.virtualDocumentSource = {
            canProvide: (scheme) => scheme === "jdt",
            provide: () => Promise.resolve("class Lib {}\n"),
        };
        const jdt = Uri.parse("jdt://contents/lib.jar/Lib.java");
        await service.openUri(jdt);

        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.saveAs");
        await dialog.settle({ title: "Save As" });
        const copyPath = ws.path("Lib.java");
        dialog.replaceQuery(copyPath);
        await dialog.settle({ query: copyPath });
        dialog.key("Enter");
        // Запись — через файловый сервис, асинхронно.
        await vi.waitFor(() => {
            expect(service.editorGroups.activeGroup.editorCount).toBe(2);
        });

        expect(fs.readFileSync(copyPath, "utf-8")).toBe("class Lib {}\n");
        expect(service.editorGroups.activeGroup.getPanes().map((pane) => pane.uri.toString())).toEqual([
            jdt.toString(),
            Uri.file(copyPath).toString(),
        ]);
        expect(service.getActiveTabPane()?.uri.toString()).toBe(Uri.file(copyPath).toString());
    });

    it("перезапись другого файла — только после «да» на вопрос эталона", async () => {
        h.commands.execute("workbench.openFile", ws.path("alpha.txt"));
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.saveAs");
        await dialog.settle({ query: ws.path("alpha.txt") });

        const betaPath = ws.path("beta.txt");
        dialog.replaceQuery(betaPath);
        await dialog.settle({ query: betaPath });
        dialog.key("Enter");
        await dialog.settle({ title: overwriteQuestion("beta.txt") });
        expect(fs.readFileSync(betaPath, "utf-8")).toBe("Beta content");

        dialog.key("Enter");
        await vi.waitFor(() => {
            expect(fs.readFileSync(betaPath, "utf-8")).toBe("Alpha content");
        });
    });

    it("отказ от перезаписи (Escape) возвращает в диалог и ничего не пишет", async () => {
        h.commands.execute("workbench.openFile", ws.path("alpha.txt"));
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.saveAs");
        await dialog.settle({ query: ws.path("alpha.txt") });
        const betaPath = ws.path("beta.txt");
        dialog.replaceQuery(betaPath);
        await dialog.settle({ query: betaPath });
        dialog.key("Enter");
        await dialog.settle({ title: overwriteQuestion("beta.txt") });
        dialog.key("Escape");
        await dialog.settle({ title: "Save As", query: betaPath });
        expect(fs.readFileSync(betaPath, "utf-8")).toBe("Beta content");
        dialog.key("Escape");
    });

    it("каталог вместо имени файла — сообщение эталона", async () => {
        h.commands.execute("workbench.openFile", ws.path("alpha.txt"));
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.saveAs");
        await dialog.settle({ query: ws.path("alpha.txt") });
        fs.mkdirSync(ws.path("folder"));
        dialog.replaceQuery(ws.path("folder"));
        await dialog.settle({ query: ws.path("folder") });
        dialog.key("Enter");
        await vi.waitFor(() => {
            expect(dialog.validationMessage()).toBe("The folder already exists. Please use a new file name.");
        });
        dialog.key("Escape");
    });

    it("несуществующий каталог — вопрос о создании, «да» создаёт его и сохраняет", async () => {
        h.commands.execute("workbench.openFile", ws.path("alpha.txt"));
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.saveAs");
        await dialog.settle({ query: ws.path("alpha.txt") });
        const target = ws.path("made/new.txt");
        dialog.replaceQuery(target);
        await dialog.settle({ query: target });
        dialog.key("Enter");
        await dialog.settle({ title: "The folder made does not exist. Would you like to create it?" });
        dialog.key("Enter");
        await vi.waitFor(() => {
            expect(fs.readFileSync(target, "utf-8")).toBe("Alpha content");
        });
    });

    it("нет активного редактора — команда ничего не показывает", () => {
        h.commands.execute("workbench.action.files.saveAs");
        h.testApp.render();
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("Escape cancels without writing anything", async () => {
        h.commands.execute("workbench.openFile", ws.path("alpha.txt"));
        h.testApp.render();
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.saveAs");
        await dialog.settle({ query: ws.path("alpha.txt") });

        const newPath = ws.path("should-not-exist.txt");
        dialog.replaceQuery(newPath);
        await dialog.settle({ query: newPath });
        dialog.key("Escape");
        await vi.waitFor(() => {
            expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);
        });
        expect(fs.existsSync(newPath)).toBe(false);
    });
});
