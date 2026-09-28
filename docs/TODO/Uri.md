# Uri — первоклассная идентичность ресурса

Задача: [#108](https://github.com/tihonove/diode/issues/108) (ядро) + [#107](https://github.com/tihonove/diode/issues/107) (`workspace.fs`).
Правила адресации и слой — [docs/arch/Common.md](../arch/Common.md#uri).

В VS Code любой ресурс адресуется `Uri`: файлы (`file:`), безымянные буферы (`untitled:`),
git-версии (`git:`), output-каналы (`output:`), diff, webview, remote/virtual ФС. В Diode
ресурс был голой строкой-путём — идентичность недисковых ресурсов класть было некуда.

Сделано (описание — [arch/Common.md](../arch/Common.md#uri)): `Uri` — адаптер над
`vscode-uri`; ext-host на общем типе; гейт `workspace.fs` для не-file схем;
идентичность ядра по `Uri`; `untitled:` — настоящая схема; undo на модель документа
(в [EditorGroups](EditorGroups.md)); `ExtHostTextDocument` по спецификации; реестр
провайдеров ФС (`IFileSystemProviderRegistry`, появился в [Diff](Diff.md) этап 1).

## Виртуальные read-only документы (сделано)

`workspace.registerTextDocumentContentProvider` доведён до провода: ресурс с не-`file:`
схемой открывается настоящей read-only вкладкой, содержимое которой даёт провайдер
расширения. Этим путём в редактор попадают исходники, которых нет на диске — `jdt:` у
стокового `redhat.java` (класс из jar, исходник JDK, декомпиляция), Go to Super
Implementation, `git:`-ревизии.

Устройство: порт `IVirtualDocumentSource` (шов ядра, как `definitionSource` и соседи) →
`EditorService.openUri` → синтетическая модель (`TextFileModel.openSynthetic`) +
`readOnly`. Схемы объявляет субпроцесс, содержимое едет обратным запросом
`workspace.provideTextDocumentContent`; `onDidChange` провайдера перечитывает открытую
вкладку.

До этой работы такой ресурс **убивал процесс**: `TextFileModel.openFile` бросал на
не-`file:` схеме, промис команды никто не ждал, и Node закрывал редактор со всеми
буферами. Поэтому вместе с фичей закрыт и класс: `openUri` не отклоняется никогда,
команды возвращают свой промис вместо `void`, `CommandRegistry.execute` вешает на него
обработчик отказа, а в главном процессе стоит последняя страховка
`process.on("unhandledRejection")` — такая же, как у extension host'а.

Демо: `e2e/scenarios/virtualDocument.scenario.ts`.

## Осталось

- [ ] **`untitled:`-провайдер** (in-memory) — шаг 3 из #107. Сейчас безымянный буфер живёт
      только в ядре; `workspace.fs` для него честно отказывает.
- [ ] **`getLanguageIdForResource(string)`** — язык безымянных буферов. Отдельная фича:
      `untitled:Untitled-3` не имеет расширения → `plaintext` (это и текущее поведение).
- [ ] **`SaveOutcome "no-file"` → `"untitled"`** — косметика, потребитель один.
- [ ] **Кэш содержимого виртуальных документов**. Сейчас модель живёт, пока живёт
      вкладка: закрыл — при следующем открытии провайдера спросят заново. В VS Code
      модель переживает закрытие вкладки (её держит `ITextModelService`). Разница
      видна только на дорогих провайдерах (`java/classFileContents` ходит на сервер).
- [ ] **`CancellationToken` у `provideTextDocumentContent`**. Провайдер получает
      токен-заглушку: запрос короткоживущий, отменять его пока некому — отменять
      открытие вкладки на полпути мы не умеем.
