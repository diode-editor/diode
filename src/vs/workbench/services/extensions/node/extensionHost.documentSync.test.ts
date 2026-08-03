import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";

// Тест ПРОДЮСЕРА document sync (правило AGENTS: на каждое новое RPC-сообщение —
// тест продюсера): настоящий редактор + настоящий subprocess. Фикстура
// recordsDocumentSync.cjs записывает, что реально доехало до расширения.

/** Мини-сервис языков: `.ts` → typescript, иначе — undefined. */
const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

interface IDumpDoc {
    uri: string;
    languageId: string;
    version: number;
    text: string;
}

interface IDumpEntry {
    kind: "activate" | "open" | "change";
    uri?: string;
    version?: number;
    text?: string;
    rangeLength?: number;
    newText?: string;
    docs?: IDumpDoc[];
}

async function dumpLog(harness: IExtensionHarness): Promise<IDumpEntry[]> {
    return (await harness.commandRegistry.execute("test.docSync.dump")) as IDumpEntry[];
}

describe("ExtensionHost — document sync producer (subprocess)", () => {
    it("правка в настоящем редакторе доезжает до расширения: полный текст, растущая версия", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "const a = 1;\n" },
            extensions: [extensionFixture("test.docSync", "recordsDocumentSync.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            await settle();

            // Активный документ запушен на host.ready ДО активации — расширение
            // видит его в workspace.textDocuments уже в activate() (так стоковый
            // vscode-languageclient читает документы на start()).
            const activate = (await dumpLog(harness)).find((e) => e.kind === "activate");
            expect(activate?.docs).toHaveLength(1);
            expect(activate?.docs?.[0].text).toBe("const a = 1;\n");
            expect(activate?.docs?.[0].languageId).toBe("typescript");
            const openVersion = activate?.docs?.[0].version ?? 0;

            // Правка НЕ сохраняется на диск — расширение обязано увидеть живой буфер.
            const editor = harness.group.getActiveEditor();
            editor?.applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "// intro\n")], "test edit");
            await settle();

            let changes = (await dumpLog(harness)).filter((e) => e.kind === "change");
            expect(changes).toHaveLength(1);
            expect(changes[0].text).toBe("// intro\nconst a = 1;\n");
            expect(changes[0].newText).toBe("// intro\nconst a = 1;\n");
            // Full-range правка покрывает весь СТАРЫЙ текст.
            expect(changes[0].rangeLength).toBe("const a = 1;\n".length);
            expect(changes[0].version ?? 0).toBeGreaterThan(openVersion);

            // Вторая правка — версия продолжает расти.
            editor?.applyExternalEdits([createTextEdit(createRange(1, 0, 1, 0), "let b = 2;\n")], "test edit");
            await settle();

            changes = (await dumpLog(harness)).filter((e) => e.kind === "change");
            expect(changes).toHaveLength(2);
            expect(changes[1].text).toBe("// intro\nlet b = 2;\nconst a = 1;\n");
            expect(changes[1].version ?? 0).toBeGreaterThan(changes[0].version ?? 0);
        } finally {
            await harness.dispose();
        }
    });

    it("didOpen на смену активного редактора; повторное открытие не дублирует событие", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.docSync", "recordsDocumentSync.cjs")],
        });
        try {
            await settle();
            const first = harness.writeFile("first.txt", "first content");
            const second = harness.writeFile("second.txt", "second content");

            harness.group.openFile(first);
            await settle();
            harness.group.openFile(second);
            await settle();
            harness.group.openFile(first);
            await settle();

            const log = await dumpLog(harness);
            // Нет открытого файла на момент активации — снапшот пуст.
            expect(log.find((e) => e.kind === "activate")?.docs).toHaveLength(0);
            const opens = log.filter((e) => e.kind === "open");
            expect(opens.map((e) => e.text)).toEqual(["first content", "second content"]);
        } finally {
            await harness.dispose();
        }
    });

    it("активация после открытия файла: workspace.textDocuments уже несёт полный текст", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [
                extensionFixture("test.noop", "noopExtension.cjs"),
                {
                    ...extensionFixture("test.docSync", "recordsDocumentSync.cjs"),
                    activationEvents: ["onLanguage:typescript"],
                },
            ],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            // Subprocess уже поднят (noop активирован eager); didOpen НЕ гейтится
            // подпиской — полный текст доезжает до реестра прямо при открытии.
            // Стоковый languageclient на start() рассылает серверу didOpen для
            // документов из workspace.textDocuments — meta-обёртка с пустым
            // текстом отравила бы сервер.
            const fp = harness.writeFile("late.ts", "export const late = true;\n");
            harness.group.openFile(fp);
            await settle();

            await harness.host.activateByEvent("onLanguage:typescript");
            await settle();

            const log = await dumpLog(harness);
            const activateDocs = log.find((e) => e.kind === "activate")?.docs;
            expect(activateDocs).toHaveLength(1);
            expect(activateDocs?.[0].text).toBe("export const late = true;\n");
            // Событие onDidOpen отфаерилось в момент открытия (подписчиков ещё не
            // было) и дедупнуто — поздний подписчик событий не получает, документы
            // он находит сам в workspace.textDocuments (семантика VS Code).
            expect(log.filter((e) => e.kind === "open")).toHaveLength(0);
        } finally {
            await harness.dispose();
        }
    });
});
