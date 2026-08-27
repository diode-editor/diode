import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Демонстрирует ленивую активацию + автодополнение настроек: builtin-расширение
// `diode-settings` активируется по `onLanguage:json` при открытии settings.json и
// подсказывает ключи настроек, а затем — значения по схеме этого ключа.
//
// Дотированный ключ (`editor.…`) в самом файле НЕ встречается (там
// `files.enableTrash`), поэтому появление строки `editor.` в попапе доказывает,
// что расширение активировалось и его completion-провайдер отработал (а не
// word-based fallback редактора). Метки в узком попапе усекаются
// (`editor.tabS…`), поэтому матчим по префиксу `editor.`.
//
// Подсказки позиционно-зависимы, поэтому ключ печатается ВНУТРИ объекта: вне его
// (например на пустой строке после `}`) позиции ключа нет и подсказок не будет —
// вставка туда всё равно дала бы невалидный JSON.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "settings.json");

export default defineScenario({
    name: "settings-completion",
    title: "Settings autocomplete (keys with quotes, values from schema)",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux (на Windows
    // e2e субпроцесс-расширения флейкают — как `editorconfig-stock`/`sea-git`).
    // Скриншот всё равно генерируется через `npm run screenshots`.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("files.enableTrash"));
        await editor.capture("editor");

        // Встаём в конец существующей записи и открываем новую строку — каретка
        // оказывается внутри объекта, в позиции ключа.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.sendKey(",");
        await editor.sendKey("Enter");

        // Кавычку ставим сами; попап откроется на первой букве (auto-suggest).
        await editor.sendKey('"');
        await editor.sendKey("e");
        await editor.sendKey("d");
        await editor.sendKey("i");

        // Строки `editor.` есть только у расширения → их появление доказывает,
        // что diode-settings активировался и отдал completion (в буфере только `"edi`).
        await editor.waitForText((t) => t.includes("editor."), { timeoutMs: 4000 });
        await editor.capture("suggest-key");

        // Дотипываем ключ до однозначного префикса и берём первый (единственный)
        // пункт. Раньше здесь было «третий сверху» — но порядок в списке зависит
        // от того, сколько `editor.*` ключей вообще есть в схеме, и любой новый
        // ключ уводил стрелки на соседа. Нужен insertSpaces: у него boolean-значения.
        // Метку в узком попапе усекает до `editor.…`, поэтому ждём не её, а сам
        // набранный префикс: фильтрация списка идёт по буферу и в том же кадре.
        await editor.sendText("tor.ins");
        await editor.waitForText((t) => t.includes('"editor.ins'), { timeoutMs: 4000 });
        await editor.sendKey("Enter");

        // В списке ключ виден без кавычек, а вставляется в них: range накрыл уже
        // набранную кавычку, поэтому она не удвоилась и не осталась висеть.
        await editor.waitForText((t) => t.includes('"editor.insertSpaces"'), { timeoutMs: 4000 });
        await editor.capture("accepted-key");

        // Значение по схеме: тип boolean → закрытый набор true/false. Набираем `f`,
        // попап открывается сам и фильтрует до `false` — в файле такого слова нет,
        // так что его появление доказывает, что значения пришли из схемы.
        await editor.sendKey(":");
        await editor.sendKey(" ");
        await editor.sendKey("f");
        await editor.waitForText((t) => t.includes("false"), { timeoutMs: 4000 });
        await editor.capture("suggest-value");
    },
});
