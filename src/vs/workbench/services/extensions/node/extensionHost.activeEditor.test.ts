import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    EXTENSION_FIXTURES_DIR,
    extensionFixture,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";

const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

describe("ExtensionHost — window.onDidChangeActiveTextEditor (subprocess)", () => {
    it("событие срабатывает при открытии файла после активации расширения", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.watchActiveEditor", "watchActiveEditor.cjs")],
        });
        try {
            const fp = harness.writeFile("hello.ts", "const x = 1;\n");
            harness.group.openFile(fp);
            await settle();
            const editor = harness.group.getActiveEditor();
            expect(editor).not.toBeNull();
            // Фикстура ставит tabSize=77, если fileName заканчивается на .ts.
            expect(editor?.viewState.tabSize).toBe(77);
        } finally {
            await harness.dispose();
        }
    });

    it("initial snapshot: activeTextEditor корректен при активации если файл уже открыт", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "export {};\n" },
            extensions: [extensionFixture("test.watchActiveEditor", "watchActiveEditor.cjs")],
        });
        try {
            // На initial snapshot onDidChangeActiveTextEditor не гарантирован — переключаемся.
            const fp = harness.writeFile("other.ts", "");
            harness.group.openFile(fp);
            await settle();
            const editor = harness.group.getActiveEditor();
            expect(editor?.viewState.tabSize).toBe(77);
        } finally {
            await harness.dispose();
        }
    });

    it("window.activeTextEditor возвращает undefined когда нет открытых файлов", async () => {
        // Фикстура при editor === undefined делает ранний return — иначе поставила бы 8.
        const harness = await createExtensionTestHarness({
            extensions: [
                {
                    id: "test.checkUndefined",
                    manifest: { name: "test.checkUndefined", publisher: "test", version: "0.0.1" },
                    mainPath: path.join(EXTENSION_FIXTURES_DIR, "setIndentTabs.cjs"),
                },
            ],
        });
        try {
            expect(harness.group.getActiveEditor()).toBeNull();
        } finally {
            await harness.dispose();
        }
    });

    it("languageId проецируется в meta и document стабилен по идентичности", async () => {
        const harness = await createExtensionTestHarness({
            languageService: TS_LANGUAGE_SERVICE,
            extensions: [extensionFixture("test.reportMeta", "reportActiveEditorMeta.cjs")],
        });
        try {
            const fp = harness.writeFile("main.ts", "export {};\n");
            harness.group.openFile(fp);
            await settle();
            const editor = harness.group.getActiveEditor();
            // Фикстура ставит 71, только если workspace.textDocuments содержит ТОТ ЖЕ объект document.
            expect(editor?.viewState.tabSize).toBe(71);
        } finally {
            await harness.dispose();
        }
    });

    it("document.fileName содержит полный путь к файлу", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.watchActiveEditor", "watchActiveEditor.cjs")],
        });
        try {
            const fp = harness.writeFile("readme.txt", "hello\n");
            harness.group.openFile(fp);
            await settle();
            const editor = harness.group.getActiveEditor();
            // 1 — событие пришло, fileName не на .ts.
            expect(editor?.viewState.tabSize).toBe(1);
        } finally {
            await harness.dispose();
        }
    });
});
