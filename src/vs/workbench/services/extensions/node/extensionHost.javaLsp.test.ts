import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_CRASH_PATTERNS, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    createMavenProject,
    type IInstalledJava,
    installJava,
    JAVA_ACTIVATION_EVENT,
    JAVA_ID,
    JAVA_LANGUAGE_SERVICE,
} from "../../../../../TestUtils/javaFixture.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";

// Холодный jdt_ws до первой диагностики — ~16 с (две JVM): щедрые таймауты —
// рабочая величина, а не запас.

// `| undefined`: при упавшем `beforeAll` безусловный `installed.dispose()` в afterAll
// подменил бы причину падения на «Cannot read properties of undefined».
let installed: IInstalledJava | undefined;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — стоковый redhat.java (jdt.ls, сквозняк)", () => {
    beforeAll(async () => {
        installed = await installJava();
        expect(installed.registration.id).toBe(JAVA_ID);
    }, 300_000);

    afterAll(() => {
        installed?.dispose();
    });

    it(
        "активация по workspaceContains:, диагностика приезжает и уходит после несохранённой правки",
        { timeout: 300_000 },
        async () => {
            const published: { resource: string; markers: readonly WireMarker[] }[] = [];
            const outputLines: { level: string; value: string }[] = [];
            // Папка воркспейса не должна совпадать с `tmpDir` со storage расширения
            // (почему — в javaFixture.createMavenProject).
            const project = createMavenProject();
            const harness: IExtensionHarness = await createExtensionTestHarness({
                languageService: JAVA_LANGUAGE_SERVICE,
                workspaceFolders: [project.root],
                // Пусто: активируем руками — `workspaceContains:` читает настоящее
                // дерево, и порядок «проект на диске → событие» тут осмысленный.
                activateEvents: [],
                diagnosticsSink: (_owner, resource, markers) => published.push({ resource, markers }),
                outputSink: {
                    append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                    show: () => undefined,
                },
                extensions: [installed!.registration],
            });
            try {
                const appPath = project.appPath;
                const appUri = Uri.file(appPath).toString();
                const markersFor = (uri: string): readonly WireMarker[] =>
                    published.filter((p) => p.resource === uri).at(-1)?.markers ?? [];

                harness.group.openFile(appPath);
                // Ленивая активация ровно тем событием, которое объявляет манифест
                // vsix: ни `*`, ни `onLanguage:java` у redhat.java нет.
                await harness.host.activateByEvent(JAVA_ACTIVATION_EVENT);
                expect(harness.host.hasExtension(JAVA_ID)).toBe(true);

                // Диагностика от НАСТОЯЩЕГО jdt.ls — readiness-сигнал: она приходит
                // только после того, как m2e импортировал проект и собрал его.
                const mismatch = await until(
                    "диагностика Type mismatch в App.java",
                    () => {
                        const hit = markersFor(appUri).find((m) =>
                            m.message.includes("cannot convert from String to int"),
                        );
                        return Promise.resolve(hit ?? null);
                    },
                    280_000,
                );
                // `int broken = message;` — десятая строка фикстуры (0-based 9).
                expect(mismatch.range.start.line).toBe(9);

                // Без сохранения: сервер обязан пере-проверить живой буфер, а не файл.
                harness.group
                    .getActiveEditor()
                    ?.applyExternalEdits([createTextEdit(createRange(9, 8, 9, 11), "String")], "fix type");
                await until(
                    "Type mismatch ушла после правки",
                    () =>
                        Promise.resolve(
                            markersFor(appUri).some((m) => m.message.includes("cannot convert from String to int"))
                                ? null
                                : true,
                        ),
                    280_000,
                );

                const crashes = outputLines.filter((l) => CLIENT_CRASH_PATTERNS.test(l.value));
                expect(crashes).toEqual([]);
            } finally {
                await harness.dispose();
                project.dispose();
            }
        },
    );
});
