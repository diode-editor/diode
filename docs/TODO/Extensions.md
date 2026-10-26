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
- [ ] `menus.commandPalette` стоковых расширений: фильтр палитры есть, но включён только у встроенных
  (`extensionMenuContributor.ts`). Включить для всех — после ключей, которые читают их `when`
  (`explorerResourceIsFolder` у editorconfig — иначе `EditorConfig.generate` пропадёт из палитры,
  e2e `editorconfig-stock`); `redhat.java` уже совпадает с эталоном (`java:serverMode`).
- [ ] Конфликты точек вклада: сейчас резолвятся только по id расширения, не по перекрывающимся language ids.

### Не типизированы в `IExtensionManifest`

Секции ниже манифест принимает как `unknown` (индексная сигнатура `contributes`); тип и потребитель
появляются вместе с фичей. `iconThemes`, `snippets` — пунктами выше и ниже.

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
- [ ] Markdown-ссылки `[текст](url)` в `window.show*Message` — тост показывает их сырым текстом, эталон
  рендерит ссылкой (`parseLinkedText`, `src/vs/base/common/linkedText.ts` у нас уже есть). Видно на
  «Go to Project Configuration» в JS-файле без jsconfig (#864).

## UI-вклады: `viewsContainers` / `views`

Устройство — [arch/workbench/Views.md](../arch/workbench/Views.md#виды-расширений-contributesviewscontainers--views).
Виды `type: "webview"` — ⛔ by design, как весь webview ([API-COVERAGE](../public/API-COVERAGE.md#not-supported-by-design)).

- [x] Переключатель контейнеров на заголовке сайдбара — замена activity bar (`containerSwitcher.ts`).
- [x] `viewsContainers` (`activitybar`/`panel`/`secondarySidebar`) и `views` —
  `api/browser/viewsExtensionPoint.ts`: контейнеры, секции-заглушки, `when` вживую, `collapsed`,
  команда `workbench.view.extension.<id>`, `<view>.focus`, неявный `onView:<id>` и его активация.
- [ ] `visibility: hidden` — вид скрыт до явного показа (нужен начальный «скрыт» без записи в
  пользовательский выбор).
- [x] `viewsWelcome` для видов расширений — `api/browser/viewsWelcomeExtensionPoint.ts` +
  `extensionViewWelcomes.ts`: текст со ссылками, кнопки, `when`/`default`/`enablement` вживую,
  `command:` с JSON-аргументами, `https:` наружу; потребитель — стоковый terraform (#823).
- [ ] `viewsWelcome` для встроенных видов (`explorer`, `scm`, `workbench.explorer.emptyView`, …) —
  сейчас чужие записи у них не показываются; иконки `$(name)` в тексте welcome рисуются как есть.
- [ ] Иконки контейнеров и видов (codicon `$(name)` в переключателе), `contextualTitle`, `initialSize`,
  `group` (порядок чужого вида в контейнере).
- [ ] Контекстное меню пункта переключателя («Move To», «Reset Location» — у эталона на иконке
  activity bar); сейчас — в «⋯» заголовка.
- [x] TreeView-API поверх RPC (`registerTreeDataProvider`/`createTreeView`, pull по handles как
  `extHostTreeViews` эталона, рендер в `TreeViewElement`) — #822. Хвосты: чекбоксы, drag and drop,
  `resolveTreeItem`, tooltip, `TreeItemLabel.highlights`.
- [x] Меню пункта дерева расширения (`view/item/context`, inline-глифы, аргумент — объект провайдера,
  мультивыбор) — #824. Хвост: `$focusedTreeItem` (`TreeViewPaneHandleArg`) для команд `view/title`.

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
- [ ] Бейдж с числом доступных обновлений на контейнере `EXTENSIONS` (у эталона `NumberBadge` на activity
  bar, считает `outdated`). У контейнеров бейджей нет — нужна механика в переключателе контейнеров на
  заголовке сайдбара. Вне этапа 2 ExtensionUpdates.
- [ ] Межпроцессная блокировка `extensions.json` профиля и `extensions/.obsolete`: гонка CLI и окна (и двух окон
  при автообновлении) может потерять запись или пометку. Сейчас — атомарный `rename` и перечитывание профиля
  перед каждой установкой (решение Ж4). Хвост этапа 0 ExtensionUpdates (эпик закрыт, спеки —
  `git show 188ea93e:docs/TODO/ExtensionUpdates.md`).

---

## Открытые вопросы

- Unbundled vs bundled extensions при SEA-сборке.
- Notebook — отдельный большой подпроект.
