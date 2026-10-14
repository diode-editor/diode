# Protobuf: стоковое `bufbuild.vscode-buf`

Статус: **запись в магазине и тесты сделаны; хвосты API открыты.** Родственные документы:
[Marketplace.md](Marketplace.md), [Terraform.md](Terraform.md) (прецедент стокового LSP),
матрица [API-COVERAGE.md](../public/API-COVERAGE.md).

## Выбор расширения (разбор 14.10.2026)

Встроенного protobuf в vscode нет, своё не заводим. Кандидаты из Open VSX, каждый прогнан в
живом Diode (`npm run drive`) на одном файле:

| Расширение | Состояние | В Diode |
|---|---|---|
| `zxh404.vscode-proto3` | архив, автор отсылает к DrBlury | только подсветка: `activate` падает на `languages.setLanguageConfiguration` |
| `DrBlury.protobuf-vsc` | живой, «официальный» преемник; 2.48★ на MS Marketplace (жалобы на регрессии и порчу строк) | подсветка и часть LSP, `activate` падает на `languages.onDidChangeDiagnostics` |
| **`bufbuild.vscode-buf`** | живой, от Buf; 4.62★ | **работает**: сам качает `buf`, LSP целиком |
| `ianandhum.protobuf-support` | живой, маленький | после установки protols: hover/F12; well-known импорты не находит |
| `tooltitudeteam.tooltitude-pb` | проприетарный | лицензия принимается в webview — в TUI `activate` висит вечно |

Ловушка выбора: у расширений разный language id для `.proto` — `proto3` (zxh404, ianandhum),
`proto` (buf, DrBlury), `protobuf` (tooltitude). Два установленных разом спорят за файл, а
провайдеры одного не видят документ другого.

## Что сделано

- Запись магазина `bufbuild.vscode-buf` (сайт#18), `support: partial`, `engines.diode >=0.8.2`.
- Стоковый сьют `extensionHost.bufLsp.test.ts`: активация по `workspaceContains:**/*.proto`,
  диагностика, hover, F12, автодополнение, Format Document. Бинарь `buf` сьют кэширует сам
  (`ensureBufCli` в `src/TestUtils/bufFixture.ts`) и отдаёт настройкой `buf.commandLine.path`:
  без неё расширение на каждом старте спрашивает GitHub API о последнем релизе, а без токена
  это 60 запросов в час на IP.
- Сценарий `buf-lsp` и смоук-чек магазина в `e2e/marketplace/checks.ts` — путь пользователя
  с автоскачиванием `buf` (и, значит, запросом к GitHub API: под лимитом может флакнуть —
  тогда в Output «Buf» будет `Failed to install buf`).

## Хвосты

- [ ] **`workspace.openTextDocument({ content, language })`** — безымянный документ от
  расширения. Без него падают `Buf: List available lint rules` / `…breaking change detection
  rules` (причина `partial` в записи магазина). Сейчас такой вызов уходит в ветку «не-file
  схема» и отклоняется `FileSystemError.Unavailable` (`workspaceNamespace.ts`).
- [ ] **`languages.onDidChangeDiagnostics` / `getDiagnostics`** — без них не активируется
  DrBlury (и, по [ClaudeCode.md](ClaudeCode.md), нужен `getDiagnostics`).
- [ ] **`languages.setLanguageConfiguration`** — без него не активируется zxh404.
- [ ] Problems склеивает многострочное сообщение диагностики: у buf
  «cannot find \`Usr\` in this scope» + перевод строки + «help: …» показано как
  `…in this scopehelp: …`.
- [ ] Не разобрано: в сессиях `npm run drive` файл, созданный снаружи (`buf config init`,
  `echo > файл`), не появляется в Explorer — и в пустой сессии без расширений тоже;
  канал File Watcher пуст, inotify в системе доступен. Проверить, не общий ли это баг
  обновления дерева (см. [EnvironmentTuning.md](EnvironmentTuning.md)).
