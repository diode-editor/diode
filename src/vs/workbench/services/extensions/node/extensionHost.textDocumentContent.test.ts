import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";

/**
 * `workspace.registerTextDocumentContentProvider` от расширения до вкладки —
 * дверь, которой в редактор попадают исходники, которых нет на диске (`jdt:` у
 * стокового `redhat.java`: класс из jar, исходник JDK, декомпиляция).
 *
 * Проверяем весь провод целиком: регистрация в субпроцессе → объявление схем
 * хосту → обратный запрос содержимого → read-only вкладка ядра.
 */

const JAVA_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".java") ? "java" : undefined),
};

const FIXTURE = extensionFixture("test.providesTextDocumentContent", "providesTextDocumentContent.cjs");

const TARGET = "jdt://contents/lib.jar/pkg/Generated.java";

describe("ExtensionHost — провайдеры содержимого недисковых ресурсов (subprocess)", () => {
    it("объявляет схему и отдаёт содержимое обратным запросом", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [FIXTURE],
            languageService: JAVA_LANGUAGE_SERVICE,
        });
        try {
            expect(harness.host.hasTextContentProvider("jdt")).toBe(true);
            expect(harness.host.hasTextContentProvider("class")).toBe(false);

            const content = await harness.host.provideTextDocumentContent(Uri.parse(TARGET));

            expect(content).toContain("public class Generated {}");
            expect(content).toContain(TARGET);
        } finally {
            await harness.dispose();
        }
    });

    it("openUri ядра открывает read-only вкладку с исходником и языком по расширению", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [FIXTURE],
            languageService: JAVA_LANGUAGE_SERVICE,
        });
        try {
            await harness.group.openUri(Uri.parse(TARGET));

            const editor = harness.group.getActiveEditor();
            expect(editor?.uri.toString()).toBe(TARGET);
            expect(editor?.getText()).toContain("public class Generated {}");
            expect(editor?.label).toBe("Generated.java");
            expect(editor?.readOnly).toBe(true);
            expect(editor?.viewState.document.languageId).toBe("java");
        } finally {
            await harness.dispose();
        }
    });

    it("onDidChange провайдера перечитывает открытую вкладку", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [FIXTURE],
            languageService: JAVA_LANGUAGE_SERVICE,
        });
        try {
            await harness.group.openUri(Uri.parse(TARGET));
            expect(harness.group.getActiveEditor()?.getText()).toContain("// rev 1");

            // Фикстура растит ревизию и стреляет `onDidChange` — ровно так это
            // делает провайдер, когда ресурс за его спиной изменился.
            await harness.commandRegistry.execute("fixture.bumpContent", TARGET);
            // Уведомление провайдера и повторный запрос содержимого — два
            // отдельных оборота настоящего IPC, микротасками их не прокачать.
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toContain("// rev 2");
        } finally {
            await harness.dispose();
        }
    });

    it("провайдер отказался отдать ресурс — вкладки нет, причина названа", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [FIXTURE],
            languageService: JAVA_LANGUAGE_SERVICE,
        });
        try {
            const failures: string[] = [];
            harness.group.onOpenFailed = (_uri, reason) => failures.push(reason);

            await harness.group.openUri(Uri.parse("jdt:///Missing.java"));

            expect(harness.group.editorCount).toBe(0);
            expect(failures).toEqual(['the "jdt:" content provider returned no content']);
        } finally {
            await harness.dispose();
        }
    });

    it("провайдер сломался — отказ доезжает как причина, а не как падение процесса", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [FIXTURE],
            languageService: JAVA_LANGUAGE_SERVICE,
        });
        try {
            const failures: string[] = [];
            harness.group.onOpenFailed = (_uri, reason) => failures.push(reason);

            await expect(harness.group.openUri(Uri.parse("jdt:///Broken.java"))).resolves.toBeUndefined();

            expect(harness.group.editorCount).toBe(0);
            expect(failures).toHaveLength(1);
            expect(failures[0]).toContain("java/classFileContents failed");
        } finally {
            await harness.dispose();
        }
    });

    it("openTextDocument расширения по такой схеме спрашивает провайдера, а не диск", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [FIXTURE],
            languageService: JAVA_LANGUAGE_SERVICE,
        });
        try {
            const text = await harness.commandRegistry.execute("fixture.readThroughOpenTextDocument", TARGET);

            expect(text).toContain("public class Generated {}");
        } finally {
            await harness.dispose();
        }
    });

    it("без провайдеров ядру нечем открыть недисковый ресурс — и оно об этом говорит", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.noop", "noopExtension.cjs")],
            languageService: JAVA_LANGUAGE_SERVICE,
        });
        try {
            const failures: string[] = [];
            harness.group.onOpenFailed = (_uri, reason) => failures.push(reason);

            expect(harness.host.hasTextContentProvider("jdt")).toBe(false);
            await harness.group.openUri(Uri.parse(TARGET));

            expect(harness.group.editorCount).toBe(0);
            expect(failures).toEqual(['no content provider is registered for the "jdt:" scheme']);
        } finally {
            await harness.dispose();
        }
    });
});
