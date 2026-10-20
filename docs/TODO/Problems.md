# Problems / диагностики

Панель Problems и подсветка диагностик в стиле VS Code. Ключевая идея: **диагностики
отвязаны от их источников**. Центральный провайдер-агностичный реестр — маркер-сервис
(аналог `IMarkerService` из VS Code, `vs/platform/markers`). LSP, problem matchers и
расширения (`languages.createDiagnosticCollection`) — это всего лишь *поставщики*,
которые пишут в реестр; панель, squiggly и счётчики — *потребители*, которые из него
читают. Поэтому «что-то рабочее» можно собрать без LSP/matchers: нужен один поставщик.

Готовое (реестр `MarkerService`, squiggle в редакторе, валидатор `settings.json`, нижняя
Panel + дерево Problems) — см. [arch/Editor.md](../arch/Editor.md) (Editor/Markers) и
[arch/workbench/Shell.md](../arch/workbench/Shell.md#нижняя-панель) (Panel-кластер: `DiagnosticsService`,
`PanelService`+`PanelComponent`, `ProblemsComponent`). Ниже — открытые этапы.

## Осталось

### [ ] 3. Дополнительные поставщики
- JSON Schema-валидация целиком (типы/enum'ы, не только неизвестные ключи).
- Problem matchers тасков — по мере появления слоёв.
- Подмешать дефолты `contributes.configuration` расширений в валидатор `settings.json`
  (иначе реальные VS Code-настройки, ещё не реализованные в Diode, помечаются как неизвестные).

### [ ] 4. Прочие потребители
Метки в gutter/overview ruler, навигация по маркерам (F8/Shift+F8), hover с сообщением.
Счётчик ошибок/варнингов — contribution к `StatusBarService` (нужен минорный апгрейд `StatusBarItem` —
клик/цвет per-item); отдельный контекст-ключ `problemsFocus` (сейчас дерево Problems под `listFocus`).

### [ ] 5. Клик по файлу раскрывает его, как у эталона
У эталона дерево Problems (`markersView.ts`) задаёт свой предикат
`expandOnlyOnTwistieClick`: файл раскрывается и сворачивается кликом по строке
независимо от `workbench.tree.expandMode`, кликом шеврона — только маркер со
связанной информацией. Наше дерево Problems стоит на дефолте `TreeViewElement`
(только шеврон, → и двойной клик). Хватит опции конструктора дерева
(`expandOnlyOnTwistieClick: false`) и теста до кадра.
