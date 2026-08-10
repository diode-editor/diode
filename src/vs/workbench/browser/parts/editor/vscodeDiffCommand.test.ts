import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { LanguageServiceDIToken } from "../../../common/coreTokens.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import { DiffEditorPane } from "./diffEditorPane.ts";

describe("vscode.diff — команда сравнения двух ресурсов", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "vexx-vscode-diff-",
            files: { "left.txt": "alpha\nbeta\n", "right.txt": "alpha\ngamma\n" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const service = () => h.container.get(EditorServiceDIToken);

    /** Активная дифф-вкладка; ждёт, пока async-хвост команды доедет (чтение с диска). */
    async function waitForDiffPane(): Promise<DiffEditorPane> {
        return vi.waitFor(() => {
            const pane = service().getPanes()[service().activeIndex];
            expect(pane).toBeInstanceOf(DiffEditorPane);
            return pane as DiffEditorPane;
        });
    }

    it("открывает дифф-вкладку: тексты с диска, метка по умолчанию, ресурсы сторон во вкладке", async () => {
        const left = Uri.file(ws.path("left.txt"));
        const right = Uri.file(ws.path("right.txt"));

        h.commands.execute("vscode.diff", left.toString(), right.toString());
        const pane = await waitForDiffPane();

        expect(pane.label).toBe("left.txt ↔ right.txt");
        expect(pane.originalUri?.toString()).toBe(left.toString());
        expect(pane.modifiedUri?.toString()).toBe(right.toString());
        // Дифф собран из содержимого обеих сторон, прочитанного с диска.
        const text = pane.viewState.document.getText();
        expect(text).toContain("beta");
        expect(text).toContain("gamma");
    });

    it("аргументы одним массивом (subprocess) и uri JSON-компонентами; свой title", async () => {
        // Из субпроцесса команда приходит как `{id, args}` — один массив, а uri
        // сериализованы их `toJSON()` в компоненты.
        h.commands.execute("vscode.diff", [
            { scheme: "file", path: ws.path("left.txt") },
            { scheme: "file", path: ws.path("right.txt") },
            "Мой дифф",
        ]);
        const pane = await waitForDiffPane();

        expect(pane.label).toBe("Мой дифф");
    });

    it("мусор вместо uri (любой из сторон) — тихий no-op", async () => {
        h.commands.execute("vscode.diff", 42, 43);
        h.commands.execute("vscode.diff", Uri.file(ws.path("left.txt")).toString(), { bogus: true });
        await flushMicrotasks();

        expect(service().getPanes()).toHaveLength(0);
    });

    it("открытый буфер важнее диска: живые правки стороны попадают в дифф", async () => {
        h.workbench.openFile(ws.path("left.txt"));
        const editor = h.activeEditor();
        editor.pushUndo(editor.viewState.type("live-"));
        expect(editor.getText()).toContain("live-alpha");

        h.commands.execute(
            "vscode.diff",
            Uri.file(ws.path("left.txt")).toString(),
            Uri.file(ws.path("right.txt")).toString(),
        );
        const pane = await waitForDiffPane();

        // Левая сторона взята из буфера с несохранённой правкой, не с диска.
        expect(pane.viewState.document.getText()).toContain("live-alpha");
    });

    it("недоступный ресурс — пустая сторона, вкладка всё равно открывается", async () => {
        h.commands.execute(
            "vscode.diff",
            "untitled:missing",
            Uri.file(ws.path("right.txt")).toString(),
        );
        const pane = await waitForDiffPane();

        expect(pane.originalUri?.toString()).toBe("untitled:missing");
        // Левая сторона пуста — весь правый текст видится добавленным.
        expect(pane.viewState.document.getText()).toContain("gamma");
    });

    it("повторный diff той же пары обновляет вкладку на месте и активирует её", async () => {
        const left = Uri.file(ws.path("left.txt")).toString();
        const right = Uri.file(ws.path("right.txt")).toString();
        h.commands.execute("vscode.diff", left, right);
        const pane = await waitForDiffPane();
        const paneCount = service().getPanes().length;

        // Уводим фокус на другую вкладку и меняем правую сторону на диске.
        h.workbench.openFile(ws.path("left.txt"));
        fs.writeFileSync(ws.path("right.txt"), "alpha\ndelta\n");

        h.commands.execute("vscode.diff", left, right);
        const updated = await waitForDiffPane();

        // Та же вкладка (идентичность — пара ресурсов), а не вторая копия…
        expect(updated === pane).toBe(true);
        expect(service().getPanes().length).toBe(paneCount + 1); // +1 — left.txt
        // …но со свежим снимком правой стороны.
        expect(updated.viewState.document.getText()).toContain("delta");
    });

    it("язык диффа берётся у правой стороны через LanguageService", async () => {
        const seen: string[] = [];
        const stub: ILanguageService = {
            getLanguageIdForResource: (filePath) => {
                seen.push(filePath);
                return "plaintext";
            },
            getLanguageDisplayName: () => undefined,
            getExtensionForLanguage: () => undefined,
        };
        h.dispose();
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            containerOverrides: (container) => {
                container.bind(LanguageServiceDIToken, () => stub);
            },
        });

        h.commands.execute(
            "vscode.diff",
            Uri.file(ws.path("left.txt")).toString(),
            Uri.file(ws.path("right.txt")).toString(),
        );
        await waitForDiffPane();

        expect(seen).toContain(ws.path("right.txt"));
    });
});
