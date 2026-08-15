# Problems / диагностики

Панель Problems и подсветка диагностик в стиле VS Code. Ключевая идея: **диагностики
отвязаны от их источников**. Центральный провайдер-агностичный реестр — маркер-сервис
(аналог `IMarkerService` из VS Code, `vs/platform/markers`). LSP, problem matchers и
расширения (`languages.createDiagnosticCollection`) — это всего лишь *поставщики*,
которые пишут в реестр; панель, squiggly и счётчики — *потребители*, которые из него
читают. Поэтому «что-то рабочее» можно собрать без LSP/matchers: нужен один поставщик.

Готовое (реестр `MarkerService`, squiggle в редакторе, валидатор `settings.json`, нижняя
Panel + дерево Problems) — см. [arch/Editor.md](../arch/Editor.md) (Editor/Markers) и
[arch/Workbench.md](../arch/Workbench.md) (Panel-кластер: `DiagnosticsService`,
`PanelService`+`PanelComponent`, `ProblemsComponent`). Ниже — модель и открытые этапы.

## Модель маркера (как в VS Code)

`IMarker { owner, resource, severity, range, message, code?, source? }`:
- `owner` — неймспейс поставщика (`"settings"`, позже `"typescript"`, `"eslint"`);
- `resource` — ресурс как `uri.toString()` (не путь: диагностики бывают и у недисковых ресурсов);
- `severity` — `Error | Warning | Info | Hint`;
- `range` — `IRange` в документе.

API реестра: `changeOne(owner, resource, markers[])`, `read({ resource?, owner?, severities? })`,
`onMarkerChanged(resources[])`.

## Слои

- **Реестр** — `src/vs/editor/Markers/` (чистый, без DI — зеркало `Editor/Tokenization`,
  `TokenizationRegistry`). DI-токен `MarkerServiceDIToken` — в `Workbench/Services/CoreTokens.ts`,
  модуль — `Workbench/Modules/MarkersModule.ts`.
- **Поставщик** — `DiagnosticsService` (`Workbench/Services/Diagnostics/`). Пишет через `changeOne`.
- **Потребитель (editor squiggly)** — тот же `DiagnosticsService` подписан на `onDidChangeMarkers`,
  фильтрует маркеры открытых редакторов (шов `IDiagnosticsEditorSource`), пушит диапазоны+severity в
  `EditorElement.setMarkerDecorations(...)`. Editor не знает про DI/Workbench/resource —
  рисует только диапазоны.
- **Потребитель (панель)** — `ProblemsComponent` (`Workbench/Components/Panel/`), подписан на весь реестр.

Точка пересчёта — `ITextDocument.onDidChangeContent` (см. [arch/Editor.md](../arch/Editor.md)).

## Осталось

### [ ] 3. Дополнительные поставщики
- JSON Schema-валидация целиком (типы/enum'ы, не только неизвестные ключи).
- Расширения: `vscode.languages.createDiagnosticCollection` → RPC → `changeOne`.
- LSP `publishDiagnostics`, problem matchers тасков — по мере появления слоёв.
- Подмешать дефолты `contributes.configuration` расширений в валидатор `settings.json`
  (иначе реальные VS Code-настройки, ещё не реализованные в Diode, помечаются как неизвестные).

### [ ] 4. Прочие потребители
Метки в gutter/overview ruler, навигация по маркерам (F8/Shift+F8), hover с сообщением.
Счётчик ошибок/варнингов — contribution к `StatusBarService` (нужен минорный апгрейд `StatusBarItem` —
клик/цвет per-item); отдельный контекст-ключ `problemsFocus` (сейчас дерево Problems под `listFocus`).
