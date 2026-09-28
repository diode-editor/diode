import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Виртуальные read-only документы: `workspace.registerTextDocumentContentProvider`
// от расширения до вкладки. Фикстурное расширение `virtual-docs-demo`
// воспроизводит контракт стокового `redhat.java` — F12 уводит на `jdt:`-ресурс,
// содержимое которого отдаёт провайдер, а не файловая система.
//
// Кадры показывают обе половины работы:
//   1. `definition` — исходник из jar открыт настоящей вкладкой, каретка стоит
//      на строке, которую назвал провайдер, замок read-only на месте;
//   2. `unknown-scheme` — запрос ресурса схемы, которую не обслуживает никто:
//      человек видит причину, а редактор жив.
//
// Вторая половина — не украшение. До этой работы такой запрос убивал процесс
// целиком: `TextFileModel.openFile` бросал на не-`file:` схеме, промис команды
// никто не ждал, и Node закрывал редактор со всеми буферами.

/** Замок read-only на вкладке (nf-cod-lock; рисует `EditorTabItemElement` движка). */
const READONLY_LOCK = "\uea75";

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "virtualDocsSample");
const sampleFile = resolve(sampleDir, "app.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-virtual-docs");

export default defineScenario({
    name: "virtual-document",
    title: "Read-only документ от registerTextDocumentContentProvider (F12 в библиотеку)",
    seedUserData: userData,
    open: [sampleDir, sampleFile],
    cols: 110,
    rows: 26,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Документ-образец"), { timeoutMs: 20_000 });
        // Провайдеры регистрируются в `activate()` расширения — он случается
        // через секунды после первого кадра. Маркер в статус-баре означает
        // «реестр провайдеров уже не пуст».
        await editor.waitForText((t) => t.includes("jdt: provider ready"), { timeoutMs: 30_000 });
        await editor.sendKey("F12");

        // Содержимое приехало от провайдера: такого файла на диске нет.
        await editor.waitForText((t) => t.includes("public final class TextUtils"), { timeoutMs: 20_000 });
        // Вкладка названа по ресурсу и помечена замком read-only: писать в
        // документ, за которым нет диска, некуда.
        await editor.waitForText((t) => t.includes(`${READONLY_LOCK} TextUtils.java`));
        await editor.capture("definition");

        // Схема без провайдера: причина названа, редактор жив и продолжает
        // отвечать (вкладка с исходником из jar никуда не делась).
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Open Unknown Scheme");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Unable to open") && t.includes("nosuchscheme"), {
            timeoutMs: 20_000,
        });
        await editor.capture("unknown-scheme");
    },
});
