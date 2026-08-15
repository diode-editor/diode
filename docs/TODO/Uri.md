# Uri — первоклассная идентичность ресурса

Задача: [#108](https://github.com/tihonove/diode/issues/108) (ядро) + [#107](https://github.com/tihonove/diode/issues/107) (`workspace.fs`).
Правила адресации и слой — [docs/arch/Common.md](../arch/Common.md#uri).

В VS Code любой ресурс адресуется `Uri`: файлы (`file:`), безымянные буферы (`untitled:`),
git-версии (`git:`), output-каналы (`output:`), diff, webview, remote/virtual ФС. В Diode
ресурс был голой строкой-путём — идентичность недисковых ресурсов класть было некуда.

## Сделано

- [x] **`Common/Uri.ts`** — адаптер над `vscode-uri` (upstream `vs/base/common/uri.ts`, MIT,
      ноль транзитивных зависимостей). Добавляет статик `Uri.joinPath` (в upstream он в
      неймспейсе `Utils`, а расширения ждут статик). Тесты — не только `file`:
      `untitled:`/`git:`/`output:`/`vscode-vfs://`, round-trip, `with`/`from`.
- [x] **Ext-host на общий тип** — file-only шим `VscodeTypes.Uri` схлопнут в ре-экспорт.
      Шим не разбирал схемы без `//` (`untitled:Untitled-1` парсился как file-путь),
      отдавал `path` из `fsPath` для любой схемы, терял authority/query/fragment.
- [x] **#107: `workspace.fs` не трогает диск для не-file URI** — гейт `uri.scheme === "file"`
      → `FileSystemError.Unavailable`. Без него `writeFile(untitled:Untitled-1)` создавал
      `$CWD/Untitled-1` (`fsPath` у не-file схемы не бросает, а отдаёт путь как есть).
      То же в `openTextDocument`. `fileUriToPath` больше не протаскивает не-file строки в путь.
- [x] **Идентичность ядра по `Uri`** — `uri` редактора первичен, `absoluteFilePath`/
      `fileName` — производные. Пять `path.resolve`-сравнений и одно сырое `!==` →
      `uri.toString()`. Подъём строки — в одной точке (`EditorService.openFile`).
- [x] **`untitled:` — настоящая схема** вместо строкового литерала и поля `untitledNumber`.
      Пять сентинелов «нет файла» сведены к схеме.
- [x] **Общий undo-бакет починен** — история ключуется стабильным per-editor id
      (`fix(editor): keep undo history per editor, not per file path`). Заодно починен
      второй баг того же класса: `saveAs` осиротлял историю.
- [x] **`ExtHostTextDocument` по спецификации** — `uri` источник правды, `fileName` —
      shorthand для `uri.fsPath`, `isUntitled` из схемы (был захардкожен `false`).
      Wire везёт `uri` вместо `fileName`.
- [x] `docs/ARCHITECTURE.md` + `docs/arch/Common.md`.

## Осталось

- [ ] **Реестр провайдеров ФС по схеме** (`IFileSystemProviderRegistry`), `file` — провайдер
      поверх `node:fs`. Задел под `registerFileSystemProvider` из `vscode.d.ts` (закомментирован;
      раскомментирование потянет `FileSystemProvider` + `MarkdownString` по лок-степ правилу).
      Шаг 2 из #107, в его DoD опционален.
- [ ] **`untitled:`-провайдер** (in-memory) — шаг 3 из #107. Сейчас безымянный буфер живёт
      только в ядре; `workspace.fs` для него честно отказывает.
- [ ] **`getLanguageIdForResource(string)`** — язык безымянных буферов. Отдельная фича:
      `untitled:Untitled-3` не имеет расширения → `plaintext` (это и текущее поведение).
- [x] **Сплит-вью и undo.** Сделано в [EditorGroups](EditorGroups.md), фаза 1:
      `TextFileModelRegistry` (одна модель на ресурс, ref-count), `UndoManager` на
      модели (один на документ), действующая вью — параметр undo/redo, чужие вью
      ремапят selections/folds/scroll по `onDidChangeContent`.
- [ ] **`SaveOutcome "no-file"` → `"untitled"`** — косметика, потребитель один.
