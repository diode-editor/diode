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

Готовое (семантические токены LSP вторым слоем — «Семантические токены» в arch/Editor.md, фоновая токенизация, матчинг скоупов темы в vscode-textmate (B2, [VscodeModel](VscodeModel.md)), интерфейсы, `TokenizationRegistry`, `DocumentTokenStore`, полный TextMate-движок с бинарными токенами и темой в vscode-textmate (`createTextMateTheme`), language detection, hot-swap, перекраска на смене темы, ленивая загрузка грамматик) — см. секцию **Editor/Tokenization/** в [docs/arch/Editor.md](../arch/Editor.md) и «Активация» в [docs/arch/Extensions.md](../arch/Extensions.md). Ниже — только открытое.

## Осталось

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
