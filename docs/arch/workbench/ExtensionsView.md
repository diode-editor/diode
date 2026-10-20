# Магазин расширений в UI

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).
Реестр, формат и клиент магазина — [../Marketplace.md](../Marketplace.md); открытые вопросы —
[../../TODO/Extensions.md](../../TODO/Extensions.md#магазин).

Вьюлет `EXTENSIONS` (поиск + каталог + установленные) и страница расширения во вкладке, установка,
обновление и удаление кнопкой — раскладка как в VS Code. Activity bar'а нет, поэтому показ вьюлета —
команда `workbench.view.extensions` (`Ctrl+Shift+X`, аккорд `Ctrl+K X` для legacy-терминалов;
конвенция `workbench.view.*`, как Explorer/Search/SCM).

## Устройство

- `contrib/extensions/common/extensionsWorkbench.ts` — контракт
  `IExtensionsWorkbenchService` + DI-токен + карточка `IExtensionListEntry`.
  Контракт в `common/`, реализация в `node/` — так вьюлет из `browser/` не
  импортирует `node/` (иначе понадобилась бы запись в списке исключений
  `scripts/check-layers.mjs`).
- `contrib/extensions/node/extensionsWorkbenchService.ts` — каталог реестра
  (через `createRegistrySource`, кэш в памяти на сессию) ∪ установленное на
  диске (`listInstalledExtensions`); состояние карточки
  (`available`/`installed`/`outdated`/`incompatible`) считается по
  `latest.engines` и версиям. Установленное **не из магазина** — тоже карточка,
  поля из его манифеста. Сетевой сбой не бросается: `getCatalogError()`.
- **Каталог** читается при первом показе вьюлета (`focus`), дальше фильтрация
  локальная (`searchRegistryIndex`), обновление — команда `extensions.refresh`
  (кнопка в заголовке секции, прогресс через `ProgressService`). На старте
  приложение в сеть не ходит. Пока каталог читается, список говорит
  `Loading extensions…` — пустой список на медленной сети читался бы как
  «магазин пуст»; сбой — строка `Retry — <причина>` в секции магазина, карточки
  установленного остаются.
- `contrib/extensions/browser/extensionsComponent.ts` — вьюлет `EXTENSIONS`
  (`view.id = "extensionsView"`): `InputElement` + `ListViewElement` с двумя
  группами (MARKETPLACE / INSTALLED), раскладка «шапка + тело» — общий
  `HeaderBodyViewElement` (вынесен из Search); активация строки
  открывает страницу через шов `IExtensionsEditorTarget` (`EditorService`
  структурно, биндинг — в `diode/modules/extensionsModule.ts`).
- `contrib/extensions/browser/extensionEditorPane.ts` — вкладка расширения:
  `IEditorPane` с ресурсом `extension:<id>` (идентичность вкладки —
  `EditorService.openPane`: повторное открытие переключает, а не плодит), тело —
  `ExtensionPageElement` поверх строк `buildExtensionPageLines`; readme — текстом
  как есть (markdown-рендерера нет). Перенос по словам свой (`wrapText`) и
  считается в раскладке: wrap-элемента в tuidom нет, а откладывать пересборку в
  микротаск значило бы показать пустую страницу первым кадром.
- **Кнопки страницы** — настоящие `ButtonElement` в закреплённой шапке; состав
  считает чистая `describeExtensionButtons` (`Install` / `Update to X.Y.Z` +
  `Uninstall` / выключенный `Install` у несовместимого с причиной / `Reload
  Window` после операции). Клавиатура — приём модальных диалогов: стрелки по
  ряду, `Tab` уводит в readme и обратно; фокус вкладки встаёт на первую доступную
  кнопку — в том числе на `Reload Window` сразу после установки.
- **Установка и удаление** — `ExtensionPageActions` (`browser/extensionPageActions.ts`):
  прогресс неопределённый (`ProgressService`, локация `window`: `fetchArtifact`
  не отдаёт прогресс скачивания), транзиентное сообщение в статус-баре
  (`showTransientNotice`), перезагрузка окна **командой**
  `workbench.action.reloadWindow` — тем же путём, что палитра и меню, включая
  вопрос о несохранённых вкладках. Ошибка установки (несовместимость, битый
  `sha256`, недоступный реестр) — значение, а не исключение: текст в шапке
  страницы, кнопка снова доступна, на диске пусто.
- **Перезагрузка окна вместо горячей активации.** Расширения сканируются один раз
  на старте, горячей перезагрузки вкладов нет, а врать «уже работает» нельзя.
  `base/node/restartProcess.ts` поднимает процесс заново с теми же аргументами,
  сессия пишется на диск до старта нового окна; первый reload делает текущий
  процесс супервизором (`spawnSync`, `stdio: "inherit"`), дальнейшие обслуживает
  он — терминал не отбирается, процессы не копятся
  ([Shell.md](Shell.md#жизненный-цикл)). Перезагружает пользователь сам, когда
  готов. Появится горячий reload — уйдёт только кнопка `Reload Window`.
- Тесты: юниты рядом с кодом и герметичные e2e против файлового
  реестра-фикстуры на настоящих `.vsix` — `e2e/extensionsView.functional.test.ts`
  (просмотр) и `e2e/extensionsInstall.functional.test.ts` (установка,
  обновление, удаление, перезагрузка окна переподключением инспектора) —
  [TESTING.md](../../TESTING.md#extensions-view-герметичный-сьют).

## Чего сознательно не делаем

- **Дисковый кэш индекса и оффлайн-режим** — заводятся вместе со своей
  инвалидацией и потребителем; пока кэш в памяти на сессию + явный Refresh.
- **Категории, сортировки, рейтинги, «популярное», авто-обновление** — в реестре
  из десятка записей это UI ради UI; `categories` вдобавок нет в мете.
- **Установку из списка одной кнопкой** (inline-кнопка строки в VS Code) —
  установка живёт на странице, чтобы решение принималось после просмотра readme
  и совместимости.
- **Встроенные расширения в `INSTALLED`** — builtin нельзя удалить, в списке они
  были бы мёртвыми строками.
- **Установку конкретной версии из UI** — `installFromRegistry` умеет
  (`options.version`), пикер версий — позже.
