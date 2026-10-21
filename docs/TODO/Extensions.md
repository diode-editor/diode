# Extensions — VS Code-совместимые расширения

Цель: загружать расширения по формату VS Code (`package.json` с `contributes`) — встроенные и из
каталога пользователя, с разгрузкой через `IDisposable` и инкрементальным добавлением точек вклада.

Готовое — в справочниках: рантайм, extension host, активация, вклады — [docs/arch/Extensions.md](../arch/Extensions.md);
магазин (реестр, формат, клиент) — [docs/arch/Marketplace.md](../arch/Marketplace.md); UI магазина —
[docs/arch/workbench/ExtensionsView.md](../arch/workbench/ExtensionsView.md); готовность API —
[docs/public/API-COVERAGE.md](../public/API-COVERAGE.md). Ниже — только открытое.

---

## Вклады (`contributes`)

- [ ] `contributes.iconThemes` / `productIconThemes` — файловые иконки.
- [ ] Language configuration: on-enter rules (smart indent после `{`, продолжение `//`-комментариев);
  bracket matching, folding markers; `notIn` string/comment у auto-closing пар (у планировщика нет токенов).
- [ ] `contributes.snippets` — парсер тел сниппетов, движок (табстопы, плейсхолдеры, трансформации),
  интеграция с автодополнением; сниппет-сессия — [Suggest](Suggest.md).
- [ ] Запись настройки в секцию языка (`WorkspaceConfiguration.update(…, overrideInLanguage)`) — пока отказ.
- [ ] Конфликты точек вклада: сейчас резолвятся только по id расширения, не по перекрывающимся language ids.

### Не типизированы в `IExtensionManifest`

Секции ниже манифест принимает как `unknown` (индексная сигнатура `contributes`); тип и потребитель
появляются вместе с фичей. `iconThemes`, `snippets`, `viewsContainers` — пунктами выше и ниже.

- [ ] `viewsWelcome`
- [ ] `colors`
- [ ] `debuggers`, `breakpoints`, `problemMatchers`, `problemPatterns`
- [ ] `jsonValidation`
- [ ] `terminal`, `walkthroughs`
- [ ] `notebooks`, `notebookRenderer`
- [ ] `customEditors`, `authentication`, `resourceLabelFormatters`
- [ ] `typescriptServerPlugins`, `htmlLanguageParticipants`

## Активация и lifecycle

- [ ] Кнопки на тосте неудовлетворённой зависимости, как у эталона (`mainThreadExtensionService`):
  «Install and Reload» (зависимость есть в магазине), «Reload Window» (установлена, но не загружена).
- [ ] `extensionPack`: члены пака ставятся вместе с ним (несовместимый член — пропуск с логом, как у
  эталона); страница расширения — вкладки Dependencies / Extension Pack.
- [ ] `IDisposable`-цепочка: при выгрузке убираются все вклады (TokenizationRegistry, CommandRegistry, …).
- [~] Горячий reload одного расширения (dispose → re-register) без перезапуска. Грубый ответ есть —
  перезагрузка окна (`workbench.action.reloadWindow`); горячему нужна dispose-цепочка выше.
- [ ] Остальные события активации (`onDebug`, `onFileSystem`, `onView`, …) — по мере появления поверхностей.

## Extension host

- [~] API `vscode.*` дальше: `revealRange`, snippets — по матрице [API-COVERAGE](../public/API-COVERAGE.md).
- [~] Изоляция исключений: упавшее расширение не валит host (RPC + try/catch, `unhandledRejection`-гард);
  осталась диагностика.
- [ ] Маршрутизация ошибок RPC обратно в `editor.options =`, чтобы fire-and-forget не глотал.
- [ ] ESM-расширения (`import * as vscode from "vscode"` через ESM loader hooks).
- [ ] Перезапуск субпроцесса при крэше (сейчас при выходе extension host'а все RPC падают).

## UI-вклады: `viewsContainers` / `views`

Модель `ViewsService` (container↔view, места `sidebar`/`panel`) готова и общая со встроенными панелями
([arch/workbench/Views.md](../arch/workbench/Views.md)) — контрибьютор ложится на готовый контракт.
Виды `type: "webview"` — ⛔ by design, как весь webview ([API-COVERAGE](../public/API-COVERAGE.md#не-будет-by-design)).

- [~] Типы `IViewContribution` / `IViewContainerContribution` в `iExtensionManifest.ts`: `views` есть,
  `viewsContainers` — нет.
- [~] Команда `<viewId>.focus` на каждый вид (`extensionViewFocusCommands.ts`): пока видов нет —
  тост с причиной и успех. Отступление: в палитру не попадает. Когда виды начнут рисоваться —
  показывает контейнер, фокусирует вид и будит `onView:<id>`.
- [ ] `extensionViewsContributor.ts` рядом с `extensionKeybindingContributor.ts` (декларативно, без
  host'а): контейнер + пустые секции с welcome-текстом; набор — из `IExtensionService.extensions` в
  своём DI-модуле, а не из `main.ts`.
- [ ] Команда показа контейнера расширения (`workbench.view.<id>`) — activity bar'а нет.
- [ ] Активация `onView:<id>`.
- [~] TreeView-API поверх RPC (`registerTreeDataProvider`/`createTreeView`, pull как у completion,
  рендер в `TreeViewElement`): типы подняты, рантайм — заглушка `api/common/treeViewNoop.ts`
  (регистрация проходит, `TreeView` инертный). Первый стоковый потребитель — форк bazel-java
  (`tihonove.bazel-java-tihonove`, view `bazelTaskOutline`).

## Магазин

- [ ] **id без учёта регистра в `--install-extension` и в поиске меты.** Open VSX пишет `golang/Go`, а
  id в манифесте — `golang.go`; реестр хранит id манифеста (сверка при установке побайтная), поэтому
  `--install-extension golang.Go` отвечает «not found». В эталоне `ExtensionIdentifier` сравнивается
  без регистра — клиенту нужен канонический id из `index.json` перед запросом `meta/<id>.json`
  (Pages регистрозависим).
- [ ] `categories` есть в `IRegistryIndexEntry`, но не в `IRegistryExtensionMeta` — вывести их сборке
  реестра неоткуда, поле не заполняется (аддитивно чинится в `registryFormat.ts`).
- [ ] Отзыв версии (`yanked`): иммутабельность запрещает удаление, а скомпрометированную версию надо
  уметь снять.
- [ ] Перезагрузка окна оставляет висеть процесс-супервизор (заблокирован в `spawnSync`, держит
  терминал и память). Плата за то, что новое окно не дерётся за терминал с шеллом; альтернатива —
  отдельный launcher на каждом старте, то есть лишние сотни миллисекунд к запуску всегда.
- [ ] Строка курсора на странице расширения подсвечена (тело — `ListViewElement`, он всегда рисует
  курсор); отключаемого курсора у виджета нет — если убирать, это задача в tuidom.
- [ ] Метка вкладки при коллизиях: две страницы с одинаковым `displayName` от разных publisher'ов
  дадут одинаковые метки (у файлов разводку делает таб-стрип по пути, здесь пути нет).
- [ ] Нужна ли секция `INSTALLED` или достаточно бейджа `Installed` на записи каталога.
- [ ] `--registry` на недоступный источник при старте: только ошибка во вьюлете или ещё и
  предупреждение на старте.
- [ ] Момент миграции на open-vsx как источник discovery — открыт (смена источника, не формата).

---

## Открытые вопросы

- Unbundled vs bundled extensions при SEA-сборке.
- Notebook — отдельный большой подпроект.
