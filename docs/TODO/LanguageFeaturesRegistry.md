# Реестр языковых провайдеров в ядре (G2)

Статус: `[~]` в работе.

Ядро не знало, какие провайдеры есть и для каких документов: реестр жил в
субпроцессе, ядру приходил один `languages.updateSubscriptions` с булевыми
`has*Providers`, а на `EditorService` висели поля-швы `*Source` (по функции на
фичу), проводимые дважды — в `extensionHostModule.ts` и `ExtensionTestHarness.ts`.
Гейт выходил глобальным: completion-провайдер TypeScript будил RPC с полным
текстом на каждый символ в `.md`. Порядка по score, `exclusive` и выбора
форматтера не было.

Как в vscode: селекторы и скоринг живут в ядре (`LanguageFeatureRegistry`,
`ILanguageFeaturesService`), extension host регистрирует в ядре прокси по
handle (`MainThreadLanguageFeatures`).

## Устройство

- `editor/common/languageSelector.ts` — `score()` селектора (порт upstream без
  notebook/`hasAccessToAllModels`/`isBuiltin`), `RelativePattern`, `exclusive`.
- `editor/common/languageFeatureRegistry.ts` — `register/has/ordered/onDidChange`.
- `editor/common/services/languageFeatures.ts` — `ILanguageFeaturesService`,
  реестр на фичу; биндинг в `tokenizationModule`.
- Субпроцесс: `languages.register {handle, kind, selector}` /
  `languages.unregister {handle}`; запрос `languages.provideX` несёт `handle`.
- Ядро: `api/browser/languageFeaturesAdapter.ts` держит прокси по handle в
  реестрах и снимает их по смерти субпроцесса.

## План

1. [x] Ядро реестра без потребителей.
2. [ ] Адаптер + hover.
3. [ ] definition + references.
4. [ ] signatureHelp (trigger/retrigger-символы — метаданные регистрации).
5. [ ] completion + resolve.
6. [ ] formatting + codeActions + on-save.
7. [ ] folding (`onDidChange` реестра вместо `onFoldingProvidersChanged`).
8. [ ] inlineCompletions.
9. [ ] Уборка: снять `languages.updateSubscriptions`, `languages.match` на
   `score`, доки (Extensions.md, Editor.md, LSP.md, VscodeStructureFollowUps.md).

Пока не сделан G3 (document sync дельтами), фичи «на каждый символ»
(completion, folding, inline, signatureHelp) ходят батчем по списку handle,
а не RPC на каждый handle — иначе полный текст документа уедет N раз.

## Не делаем

notebook, `hasAccessToAllModels`, `isBuiltin`; `editor.defaultFormatter` и пикер
форматтеров (нужна идентичность расширения в регистрации — G7); закрытие no-op
провайдеров (`rename`, `documentSymbol`, …) — это фичи поверх реестра;
`virtualDocumentSource` (в upstream это `ITextModelService`).
