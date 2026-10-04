import * as fs from "node:fs";

import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    prepareRenameAt,
    provideRename,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRenameRequest } from "../../../../editor/common/languages/iRenameSource.ts";

// Rename end-to-end с настоящим субпроцессом: расширение регистрирует
// провайдера, ядро спрашивает его через реестр по handle, а правки ложатся
// существующим `workspace.applyEdit` — в открытый документ И в закрытый
// соседний файл.

const FIXTURE = extensionFixture("test.providesRename", "providesRename.cjs");
const CONTENT = "const value = 1;\nconst other = value;\nkeyword\n";

function requestFor(uri: string, line: number, versionId: number): IRenameRequest {
    return { uri, languageId: "plaintext", versionId, line, character: 8 };
}

describe("ExtensionHost — rename providers (subprocess)", () => {
    it("настоящий провайдер: имя символа и правки по открытому и закрытому файлу", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.txt", content: CONTENT },
            extensions: [FIXTURE],
        });
        try {
            await settle();
            const mainPath = `${harness.tmpDir}/main.txt`;
            const mainUri = Uri.file(mainPath).toString();
            const neighbour = harness.writeFile("other.txt", "value here\n");

            // `{range, placeholder}` провайдера доезжает именем символа…
            expect(await prepareRenameAt(harness, requestFor(mainUri, 0, documentVersion(harness, mainUri)))).toEqual({
                name: "value",
            });
            // …голый Range — именем из текста того же диапазона…
            expect(await prepareRenameAt(harness, requestFor(mainUri, 1, documentVersion(harness, mainUri)))).toEqual({
                name: "value",
            });
            // …а отказ провайдера — причиной для человека.
            expect(await prepareRenameAt(harness, requestFor(mainUri, 2, documentVersion(harness, mainUri)))).toEqual({
                name: null,
                rejectReason: "You cannot rename this element.",
            });

            const result = await provideRename(
                harness,
                requestFor(mainUri, 0, documentVersion(harness, mainUri)),
                "renamed",
            );
            await settle();
            expect(result).toEqual({ applied: true });
            // Открытый документ правится через свой буфер…
            expect(harness.group.getActiveEditor()?.getText()).toBe(
                "const renamed = 1;\nconst other = value;\nkeyword\n",
            );
            // …а ЗАКРЫТЫЙ соседний файл — записью на диск (bulk edit).
            expect(fs.readFileSync(neighbour, "utf8")).toBe("renamed here\n");
        } finally {
            await harness.dispose();
        }
    });

    it("невалидное имя — отказ с сообщением провайдера; документ не тронут", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.txt", content: CONTENT },
            extensions: [FIXTURE],
        });
        try {
            await settle();
            const mainUri = Uri.file(`${harness.tmpDir}/main.txt`).toString();

            expect(
                await provideRename(harness, requestFor(mainUri, 0, documentVersion(harness, mainUri)), "class"),
            ).toEqual({
                applied: false,
                error: "'class' is not a valid identifier",
            });
            // Провайдер без правок — отказ БЕЗ сообщения (переименовывать нечего).
            expect(
                await provideRename(harness, requestFor(mainUri, 0, documentVersion(harness, mainUri)), "nothing"),
            ).toEqual({ applied: false });
            await settle();
            expect(harness.group.getActiveEditor()?.getText()).toBe(CONTENT);
        } finally {
            await harness.dispose();
        }
    });

    it("без провайдеров реестр rename пуст: имени нет, переименование не применяется", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.txt", content: CONTENT },
            extensions: [extensionFixture("test.noop", "noopExtension.cjs")],
        });
        try {
            await settle();
            const mainUri = Uri.file(`${harness.tmpDir}/main.txt`).toString();

            expect(await prepareRenameAt(harness, requestFor(mainUri, 0, documentVersion(harness, mainUri)))).toEqual({
                name: null,
            });
            expect(
                await provideRename(harness, requestFor(mainUri, 0, documentVersion(harness, mainUri)), "renamed"),
            ).toEqual({ applied: false });
        } finally {
            await harness.dispose();
        }
    });
});
