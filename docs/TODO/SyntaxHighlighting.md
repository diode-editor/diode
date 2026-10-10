# Подсветка синтаксиса

**Статус**: TextMate-движок работает (vscode-textmate + oniguruma), hot-swap токенайзера сделан, грамматики грузятся лениво (по языку открытого документа) + фоновый прогрев остальных, семантические токены LSP — вторым слоем; остались scope-селекторы и background-токенизация.

Архитектура повторяет VS Code:

```
ITokenizationSupport ── ┐
       │                │
       ▼                ▼
DocumentTokenStore   TokenizationRegistry (DI)
       │
       ▼
EditorElement.render() ── ITokenStyleResolver ── (Theme) TokenThemeResolver
```

Готовое (интерфейсы, `TokenizationRegistry`, `DocumentTokenStore`, полный TextMate-движок, `TokenThemeResolver`, language detection, hot-swap, перекраска на смене темы, ленивая загрузка грамматик) — см. секцию **Editor/Tokenization/** в [docs/arch/Editor.md](../arch/Editor.md) и «Активация» в [docs/arch/Extensions.md](../arch/Extensions.md). Ниже — только открытое.

## Осталось

### [ ] Полный TextMate scope selector matcher
Сейчас `TokenThemeResolver` поддерживает только longest-prefix scope match по dot-сегментам. Добавить:

- **Parent selectors** (`meta.foo bar` — match если в скоуп-стеке есть `meta.foo`, и текущий — `bar.*`).
- **Exclusion** (`-bar`, `text -comment`).
- **Множественные селекторы через запятую** уже работают (`compileRules` разворачивает).
- **Weighted scoring**: TextMate-спека считает вес селектора как `(specificity, depth)` — важно когда два правила одинаково подходят.

**План:**
1. Заменить `scopeMatches(rule, scope)` на парсер селектора → структура `{ scopes: string[], excludes: string[] }`.
2. `resolve(scopeStack)` уже принимает массив (top-down). Перейти на bottom-up для матчинга parent-селекторов: для каждого правила проверить «совпадает ли паттерн с подпоследовательностью стека».
3. Скоринг: сейчас сортируем по `segments` desc + `order` desc. Добавить третий ключ — `parentDepth` (длина совпавшей подпоследовательности).
4. **Тесты:** `TokenThemeResolver.ScopeSelectors.test.ts` (parent), `TokenThemeResolver.Exclusion.test.ts`. Кейсы из VS Code (`vs/editor/test/common/modes/supports/tokenization.test.ts`) — хорошая база.

**Что не делать:** полный TM scope selector grammar (group, `|` внутри селектора) — этого нет даже у VS Code. Достаточно того, что использует Dark+/Light+.

### [x] Семантические токены LSP поверх TextMate

Сделано по эталону: провайдеры расширений по RPC (с дельтами и `onDidChangeSemanticTokens`),
хранилище на документ со сдвигом на правках, второй слой при отрисовке, `semanticTokenColors`
тем + фоллбэк type/modifier → TM-скоупы, `contributes.semanticToken*`, настройка
`editor.semanticHighlighting.enabled`. Устройство — «Семантические токены» в
[docs/arch/Editor.md](../arch/Editor.md). Не поддержано: `editor.semanticTokenColorCustomizations`
(нет и `editor.tokenColorCustomizations`), литеральные дефолты стилей по типу темы в
`TokenStyleDefaults` (их не задают ни эталон, ни расширения).

### [ ] Background tokenization (chunked)
Сейчас `tokenizeUpTo(target)` синхронный. На больших файлах блокирует render.

**План:**
1. В `DocumentTokenStore` метод `scheduleBackgroundTokenization()`. В Node — `setImmediate`.
2. Каждая итерация — фиксированный budget (5 мс или 200 строк), потом yield. После yield — продолжить с `invalidLineIndex` (если что-то снова инвалидировалось).
3. **Не дублировать работу с render.** Если `EditorElement.render` уже вызвал `tokenizeUpTo(visibleEnd)` — фоновая задача начинает с `max(visibleEnd, invalidLineIndex)`.
4. **Сигнал «весь документ затокенизирован»:** event `onDidTokenizeAll`. Полезно для feature вроде «document symbols» из токенов.

**Граничный случай:** end-state convergence уже умеет «пропустить хвост». Если фоновая задача доходит до места, где endState не изменился, она прекращает работу досрочно (текущая логика и так это делает).

### [ ] Language detection — остаточные пункты
`ILanguageService`/`LanguageRegistry` резолвят по `extensions`/`filenames`/`filenamePatterns`. Не хватает:

- [ ] **Шебанг** (`firstLine`): в манифесте типизировано, но в `getLanguageIdForResource` не используется. Требует расширения API (принять `firstLine`).
- [ ] **mimetypes** — типизировано, не используется.
- [ ] **VS Code-style modeline** (`vim: set filetype=...`) — отдельная задача.
- [ ] **`filenamePatterns` с `/`** (например `**/.gitconfig`) не матчатся: `matchGlob` сравнивает только basename. Pre-existing ограничение, стало заметнее с полным набором языковых паков.
- [ ] **Команда `editor.action.changeLanguage`** — UI-пикер поверх готовой закладки: `EditorPane.setLanguage(langId)` уже меняет язык документа и пересаживает токенизатор; языки для пикера — `LanguageRegistry.allLanguages()`.

### [ ] Bracket pair colorization (низкий приоритет)
VS Code держит отдельный bracket pair index поверх токенов. Можно отложить до полного TM. Точка интеграции — `TokenIndex` в `EditorElement.render` мог бы дополнительно отдавать bracket-level для оверрайда цвета.

### Открытый вопрос
- Бинарный API `tokenizeLine2` (быстрее, но требует переделки рендера на работу с metadata) — пока не используется.

## Связанные файлы

- `src/vs/editor/Tokenization/` — все интерфейсы и реализации
- `src/vs/workbench/services/themes/common/tokenThemeResolver.ts` — резолвер скоупов
- `src/vs/editor/browser/editorElement.ts` — `TokenIndex`, `packStyleFlags`, рендеринг с цветами
- `src/vs/workbench/browser/parts/editor/editorComponent.ts` — wiring per-document store
- `src/vs/diode/main.ts` — регистрация встроенных токенайзеров
