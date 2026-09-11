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

## Осталось

- [ ] **`untitled:`-провайдер** (in-memory) — шаг 3 из #107. Сейчас безымянный буфер живёт
      только в ядре; `workspace.fs` для него честно отказывает.
- [ ] **`getLanguageIdForResource(string)`** — язык безымянных буферов. Отдельная фича:
      `untitled:Untitled-3` не имеет расширения → `plaintext` (это и текущее поведение).
- [ ] **`SaveOutcome "no-file"` → `"untitled"`** — косметика, потребитель один.
