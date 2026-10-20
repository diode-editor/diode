# Подсветка синтаксиса

**Статус**: TextMate-движок работает (vscode-textmate + oniguruma), hot-swap токенайзера сделан, грамматики грузятся лениво (по языку открытого документа) + фоновый прогрев остальных, семантические токены LSP — вторым слоем; фоновая и вьюпортная токенизация перенесены из эталона ([VscodeModel](VscodeModel.md), B1); бинарные токены и тема в vscode-textmate (B2).

Архитектура повторяет VS Code:

```
ITokenizationSupport ── ┐
       │                │
       ▼                ▼
DocumentTokenStore   TokenizationRegistry (DI)
       │
       ▼
EditorElement.render() ── ITokenStyleResolver ── ColorMapTokenStyleResolver (colorMap темы)
```

Готовое (интерфейсы, `TokenizationRegistry`, `DocumentTokenStore`, полный TextMate-движок с бинарными токенами и темой в vscode-textmate (`createTextMateTheme`), language detection, hot-swap, перекраска на смене темы, ленивая загрузка грамматик) — см. секцию **Editor/Tokenization/** в [docs/arch/Editor.md](../arch/Editor.md) и «Активация» в [docs/arch/Extensions.md](../arch/Extensions.md). Ниже — только открытое.

## Осталось

### [x] Полный TextMate scope selector matcher
Закрыто B2 ([VscodeModel](VscodeModel.md)): тему матчит vscode-textmate (`Registry.setTheme`,
как у эталона) — родительские селекторы (`meta.foo bar`), специфичность и порядок правил;
собственный резолвер скоупов удалён. Видимые изменения против прежнего резолвера — только там,
где он расходился с VS Code: Monokai (безскоупное правило темы перекрывало цвет строк и
комментариев у их пунктуации), Dark 2026 (`markup.heading entity.name`).

### [x] Семантические токены LSP поверх TextMate

Сделано по эталону: провайдеры расширений по RPC (с дельтами и `onDidChangeSemanticTokens`),
хранилище на документ со сдвигом на правках, второй слой при отрисовке, `semanticTokenColors`
тем + фоллбэк type/modifier → TM-скоупы, `contributes.semanticToken*`, настройка
`editor.semanticHighlighting.enabled`. Устройство — «Семантические токены» в
[docs/arch/Editor.md](../arch/Editor.md). Не поддержано: `editor.semanticTokenColorCustomizations`
(нет и `editor.tokenColorCustomizations`), литеральные дефолты стилей по типу темы в
`TokenStyleDefaults` (их не задают ни эталон, ни расширения).

### [x] Background tokenization
Перенесена из эталона (`model/textModelTokens.ts`) — [VscodeModel](VscodeModel.md), B1;
устройство — «Editor/Tokenization» в [arch/Editor.md](../arch/Editor.md).

### [ ] Language detection — остаточные пункты
`ILanguageService`/`LanguageRegistry` резолвят по `extensions`/`filenames`/`filenamePatterns`. Не хватает:

- [ ] **Шебанг** (`firstLine`): в манифесте типизировано, но в `getLanguageIdForResource` не используется. Требует расширения API (принять `firstLine`).
- [ ] **mimetypes** — типизировано, не используется.
- [ ] **VS Code-style modeline** (`vim: set filetype=...`) — отдельная задача.
- [ ] **`filenamePatterns` с `/`** (например `**/.gitconfig`) не матчатся: `matchGlob` сравнивает только basename. Pre-existing ограничение, стало заметнее с полным набором языковых паков.
- [ ] **Команда `editor.action.changeLanguage`** — UI-пикер поверх готовой закладки: `EditorPane.setLanguage(langId)` уже меняет язык документа и пересаживает токенизатор; языки для пикера — `LanguageRegistry.allLanguages()`.

### [ ] Bracket pair colorization (низкий приоритет)
VS Code держит отдельный bracket pair index поверх токенов. Можно отложить до полного TM. Точка интеграции — `TokenIndex` в `EditorElement.render` мог бы дополнительно отдавать bracket-level для оверрайда цвета.


## Связанные файлы

- `src/vs/editor/Tokenization/` — все интерфейсы и реализации
- `src/vs/workbench/services/themes/common/textMateTheme.ts` — тема для vscode-textmate и colorMap
- `src/vs/editor/common/languages/colorMapTokenStyleResolver.ts` — стиль токена по метаданным
- `src/vs/editor/browser/editorElement.ts` — `TokenIndex`, `packStyleFlags`, рендеринг с цветами
- `src/vs/workbench/browser/parts/editor/editorComponent.ts` — wiring per-document store
- `src/vs/diode/main.ts` — регистрация встроенных токенайзеров
