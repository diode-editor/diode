# Реестр языковых провайдеров в ядре (G2)

Статус: `[x]` сделано (G2: #384, #399, #419, #424, #427, #443, #464, #471 и этот, 9/9). Устройство и рецепт новой фичи — [arch/Extensions.md](../arch/Extensions.md), «Языковые провайдеры — реестр ядра».

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
2. [x] Адаптер + hover.
3. [x] definition + references.
4. [x] signatureHelp (trigger/retrigger-символы — метаданные регистрации).
5. [x] completion + resolve.
6. [x] formatting + codeActions + on-save.
7. [x] folding (`onDidChange` реестра вместо `onFoldingProvidersChanged`).
8. [x] inlineCompletions.
9. [x] Уборка: снять `languages.updateSubscriptions`, `languages.match` на
   `score`, доки (Extensions.md, Editor.md, LSP.md, VscodeStructureFollowUps.md).

Пока не сделан G3 (document sync дельтами), фичи «на каждый символ»
(completion, folding, inline) ходят пачкой по списку handle
(`ProviderRequestBatcher`), а не RPC на каждый handle — иначе полный текст
документа уехал бы N раз. SignatureHelp спрашивается по очереди до первого
ответа (как upstream) — пачка ему не нужна: обычно отвечает первый провайдер.

## Что осталось за рамками

- Пачка `{handles}` снимается после G3 — тогда «один RPC на handle», как upstream.
- `editor.defaultFormatter`/пикер форматтеров — после G7 (идентичность расширения в регистрации).
- Закрытие 19 no-op провайдеров — фичи поверх реестра, рецепт в arch/Extensions.md.
- Контекст-ключи `editorHas*Provider` — теперь возможны (`registry.has`), это F3/C7.
- Переезд агрегаторов и фич в `editor/contrib` — VscodeStructureFollowUps.md.

## Не делаем

notebook, `hasAccessToAllModels`, `isBuiltin`; `editor.defaultFormatter` и пикер
форматтеров (нужна идентичность расширения в регистрации — G7); закрытие no-op
провайдеров (`rename`, `documentSymbol`, …) — это фичи поверх реестра;
`virtualDocumentSource` (в upstream это `ITextModelService`).
