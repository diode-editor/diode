import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_CRASH_PATTERNS, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    provideCompletions,
    provideDefinitions,
    provideHovers,
    provideReferences,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    APP_JAVA,
    createMavenProject,
    type IInstalledJava,
    type IMavenProject,
    installJava,
    JAVA_ACTIVATION_EVENT,
    JAVA_ID,
    JAVA_LANGUAGE_SERVICE,
} from "../../../../../TestUtils/javaFixture.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ICoreDefinitionLocation } from "../../../../editor/common/languages/iDefinitionSource.ts";
import type { ICoreHover } from "../../../../editor/common/languages/iHoverSource.ts";
import type { IWireStatusBarItem } from "../../../api/common/wireTypes.ts";

// Фич-матрица Java на НАСТОЯЩЕМ jdt.ls: hover, автодополнение, definition внутри
// проекта, references и пункт статус-бара. Базовый сьют (extensionHost.javaLsp)
// проверяет загрузку и диагностики; здесь — то, что ломается молча, когда мы
// курочим редактор и API, а расширение при этом продолжает активироваться.
//
// ОДИН харнесс на все кейсы, в отличие от python-сьютов с их файлом на фичу:
// холодный старт jdt.ls — это две JVM и импорт проекта (~16с), и платить их
// пятикратно нечем. Кейсы друг друга не портят: все читают один буфер и ничего
// в нём не меняют.

let installed: IInstalledJava | undefined;
let project: IMavenProject | undefined;
let harness: IExtensionHarness | undefined;
let appUri: string;
const outputLines: { level: string; value: string }[] = [];
const statusBarItems: IWireStatusBarItem[] = [];

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — стоковый redhat.java: фичи языка", () => {
    beforeAll(async () => {
        installed = await installJava();
        project = createMavenProject();
        harness = await createExtensionTestHarness({
            languageService: JAVA_LANGUAGE_SERVICE,
            workspaceFolders: [project.root],
            activateEvents: [],
            outputSink: {
                append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                show: () => undefined,
            },
            statusBarItemSink: {
                update: (item) => statusBarItems.push(item),
                remove: () => undefined,
                clear: () => undefined,
            },
            extensions: [installed.registration],
        });
        appUri = Uri.file(project.appPath).toString();
        harness.group.openFile(project.appPath);
        await harness.host.activateByEvent(JAVA_ACTIVATION_EVENT);
        expect(harness.host.hasExtension(JAVA_ID)).toBe(true);

        // Готовность сервера: пока проект не импортирован, провайдеры отвечают
        // пустым, и кейсы ниже гонялись бы по недостроенному состоянию.
        await until(
            "hover отвечает (сервер готов)",
            async () => {
                if (harness === undefined) return null;
                const found = await provideHovers(harness, {
                    uri: appUri,
                    languageId: "java",
                    versionId: documentVersion(harness, appUri),
                    line: 8,
                    character: 27,
                });
                return found.length > 0 ? found : null;
            },
            280_000,
        );
    }, 400_000);

    afterAll(async () => {
        await harness?.dispose();
        project?.dispose();
        installed?.dispose();
    });

    it("hover над вызовом отдаёт сигнатуру из объявления", { timeout: 120_000 }, async () => {
        expect(harness).toBeDefined();
        // Каретка на `greet(` в строке `String message = greet("world");`.
        // Через `until`: пока сервер крутит фоновую работу, он отвечает пустым —
        // одиночный вызов тут флакует (проверено).
        const hovers: readonly ICoreHover[] = await until(
            "hover над `greet`",
            async () => {
                const found = await provideHovers(harness!, {
                    uri: appUri,
                    languageId: "java",
                    versionId: documentVersion(harness!, appUri),
                    line: 8,
                    character: 27,
                });
                return found.length > 0 ? found : null;
            },
            60_000,
        );
        const joined = hovers.flatMap((h) => h.contents).join("\n");
        // Полностью квалифицированной формы в буфере нет НИГДЕ — значит подпись
        // действительно пришла от сервера, а не списана с видимого текста.
        expect(joined).toContain("String demo.App.greet(String who)");
    });

    it("автодополнение отдаёт члены типа из JDK", { timeout: 120_000 }, async () => {
        expect(harness).toBeDefined();
        // Каретка внутри `System.out.println(...)` сразу ПОСЛЕ `System.out.` —
        // позиция есть в самом буфере, подменять текст не нужно. Это важно: если
        // прислать в запрос текст, отличный от открытого буфера, ответ зависит от
        // того, успела ли доехать синхронизация, и кейс флакует (поймано красным
        // CI: сервер дополнял `System.` и отдавал единственный `out`).
        const items = await until(
            "completion после `System.out.`",
            async () => {
                const found = await provideCompletions(harness!, {
                    uri: appUri,
                    languageId: "java",
                    versionId: documentVersion(harness!, appUri),
                    line: 10,
                    character: 19,
                });
                return found.items.length > 0 ? found.items : null;
            },
            60_000,
        );
        const labels = items.map((i) => i.label);
        // `println` — член java.io.PrintStream из java.base: classpath JDK доехал
        // до сервера, а не просто слова из текущего файла.
        expect(labels).toContain("println");
    });

    it("definition внутри проекта ведёт на объявление метода", { timeout: 120_000 }, async () => {
        expect(harness).toBeDefined();
        // Через `until` по той же причине, что у hover.
        const targets: readonly ICoreDefinitionLocation[] = await until(
            "definition для `greet`",
            async () => {
                const found = await provideDefinitions(harness!, {
                    uri: appUri,
                    languageId: "java",
                    versionId: documentVersion(harness!, appUri),
                    line: 8,
                    character: 27,
                });
                return found.length > 0 ? found : null;
            },
            60_000,
        );
        const target = targets[0];
        // Цель — файл на диске (не `jdt:`), строка объявления `static String greet`.
        expect(target.uri).toBe(appUri);
        expect(target.range.start.line).toBe(3);
    });

    it("references находит объявление и вызов", { timeout: 120_000 }, async () => {
        expect(harness).toBeDefined();
        const found = await until(
            "references для greet",
            async () => {
                const refs = await provideReferences(harness!, {
                    uri: appUri,
                    languageId: "java",
                    versionId: documentVersion(harness!, appUri),
                    line: 3,
                    character: 18,
                    includeDeclaration: true,
                });
                return refs.length > 0 ? refs : null;
            },
            60_000,
        );
        // Объявление (строка 3) и вызов (строка 8) — обе позиции в одном файле.
        const lines = found.map((r) => r.range.start.line).sort((a, b) => a - b);
        expect(lines).toContain(8);
    });

    it("расширение публикует пункт статус-бара со своим состоянием", { timeout: 120_000 }, async () => {
        // Провод `window.statusBarItem.*` — наш, не расширения: сломается он —
        // Java продолжит работать, а единственный индикатор «сервер жив» исчезнет.
        const ready = await until(
            "пункт статус-бара про Java",
            () => Promise.resolve(statusBarItems.find((i) => i.text.includes("Java")) ?? null),
            60_000,
        );
        expect(ready.id).toBe("redhat.java.java.serverStatus");
        expect(ready.alignment).toBe("left");
    });

    it("конвертеры стокового клиента не падали молча", () => {
        const crashes = outputLines.filter((l) => CLIENT_CRASH_PATTERNS.test(l.value));
        expect(crashes).toEqual([]);
    });
});
