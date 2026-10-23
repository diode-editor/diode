# Магазин расширений в UI

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).
Реестр, формат и клиент магазина — [../Marketplace.md](../Marketplace.md); открытые вопросы —
[../../TODO/Extensions.md](../../TODO/Extensions.md#магазин).

Вьюлет `EXTENSIONS` (поиск + каталог + установленные) и страница расширения во вкладке, установка,
обновление и удаление кнопкой — раскладка как в VS Code. Activity bar'а нет: вьюлет выбирают в
[переключателе контейнеров](Views.md#переключатель-контейнеров-вместо-activity-bar) на заголовке сайдбара
или командой `workbench.view.extensions` (`Ctrl+Shift+X`, аккорд `Ctrl+K X` для legacy-терминалов;
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
  (`available`/`installed`/`outdated`/`incompatible`) считается от **целевой версии** —
  максимальной совместимой в реестре (`resolveCompatibleVersion`: платформа и `engines`). Индекс несёт
  только `latest` и не знает платформ, поэтому при чтении каталога `meta` догружают для записей с
  несовместимым `latest` и для установленных, у которых `latest` выше установленной (версия может быть
  только под чужую платформу); цель — из `meta`, а без неё — `latest`, если подходят `engines`. Тот же кэш,
  что у страницы; сбой одной `meta` — `warn` в лог `Extensions`, не ошибка каталога. `latestVersion`
  карточки — цель (совместимых нет — `latest` индекса, для текста причины); `incompatible` — только
  когда совместимых нет вовсе; `outdated` — установленная **ниже** цели по semver (`semver.gt`, как
  эталон): откат и `.vsix` новее реестра обновлением не выглядят. По `availability`, а не по
  неравенству версий, рисуются бейдж `Update X`, кнопка `Update to X` и статус страницы. Установленное **не из магазина** — тоже карточка,
  поля из его манифеста. Сетевой сбой не бросается: `getCatalogError()`.
- **Каталог** читается при первом показе вьюлета (`focus`), дальше фильтрация
  локальная (`searchRegistryIndex`), обновление — команда `extensions.refresh`
  (кнопка в заголовке секции, прогресс через `ProgressService`). На старте
  приложение в сеть не ходит. Пока каталог читается, список говорит
  `Loading extensions…` — пустой список на медленной сети читался бы как
  «магазин пуст»; сбой — строка `Retry — <причина>` в секции магазина, карточки
  установленного остаются. Кэш `meta` живёт всю сессию; его обновляет только
  `Check for Updates` и только после успешного чтения индекса (офлайн список остаётся прежним).
- **Запрос `@outdated`** (как `/@outdated/i` эталона, в любом месте и регистре): только устаревшие,
  остаток запроса фильтрует как обычно (`parseExtensionQuery` в `common/`). Устаревшие установлены по
  определению, поэтому под `@outdated` секции `MARKETPLACE` нет — строки не дублируются.
- **Ручное обновление** (ExtensionUpdates, этап 2; эталон — `checkForUpdates` / `updateAll` в
  `extensions.contribution.ts`), `browser/extensionUpdateActions.ts`:
  - `Extensions: Check for Extension Updates` (`workbench.extensions.action.checkForUpdates`) —
    `IExtensionsWorkbenchService.checkForUpdates()`: сброс кэша `meta` + перечитывание индекса, прогресс
    в секции. Есть устаревшие — вьюлет показывается с поиском `@outdated ` (`openSearch` эталона,
    `ExtensionsComponent.setQuery`); нет — модальное `All extensions are up to date.`; реестр
    недоступен — уведомление `Could not check for extension updates: <причина>` и строка `Retry —`.
    Доступна всегда: сама читает каталог.
  - `Extensions: Update All Extensions` (`workbench.extensions.action.updateAllExtensions`) —
    `updateAll()`: все `getOutdated()` (профиль, известные реестру, без устанавливаемых сейчас, **включая закреплённые** — решение
    Е1, как эталон; закрепление блокирует только автообновление) обычной установкой без `version`, по
    одной, закрепление сохраняется; сбой одного не останавливает остальные. Прогресс `Updating
    extensions` в окне, итог — **одно** уведомление (`describeUpdateAllResult`): `Updated N extension(s).
    Reload the window to apply.` или `Updated N of M extensions. Failed: <id> — <причина>; …`, кнопка
    `Reload Window` (та же команда, что на странице), если обновилось хоть одно. Доступность —
    typed when-контекст `hasOutdatedExtensions` (имя эталона, `ExtensionUpdateContribution`): до
    первого чтения каталога ложен.
  - Обе — в меню `⋯` заголовка секции `EXTENSIONS`, группа `1_updates`, порядок 1 и 2 (у эталона —
    `ViewContainerTitle`; у нас в контейнере одна секция, и её `⋯` — то же место).
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
  `Install Specific Version...` у всего, что знает реестр, + `Uninstall` / выключенный `Install` у
  несовместимого с причиной / `Reload Window` после операции). Не влезающие в ширину кнопки
  переносятся на следующую строку (жадно, по порядку; фокус переживает перестройку). Клавиатура —
  приём модальных диалогов: стрелки по ряду, `Tab` уводит в readme и обратно; фокус вкладки встаёт
  на первую доступную кнопку — в том числе на `Reload Window` сразу после установки.
- **Конкретная версия и закрепление** (ExtensionUpdates, этап 1; эталон —
  `InstallAnotherVersionAction` / `InstallSpecificVersionOfExtensionAction`). Кнопка
  `Install Specific Version...` (у эталона — пункт контекстного меню расширения, которого у нас нет)
  открывает quick pick `Select Version to Install`: версии из `meta`, **совместимые** с этой сборкой
  (`compatibleVersions`: платформа и `engines`, по строке на версию, от новой к старой), описание —
  возраст `publishedAt` (`fromNow(…, true)` эталона, `2 mos ago`) и ` (current)` у установленной.
  Выбор текущей или Escape — ничего; совместимых нет — модальное `This extension has no other
  versions.` (`dialogService.info` эталона). Выбранная версия ставится как обычная установка
  (`install(id, { version })`) и **закрепляется**: `metadata.pinned` в `extensions.json` профиля
  ([Extensions.md](../Extensions.md)). Закрепление не меняет `outdated` и кнопку `Update to X` (как
  эталон); его читают будущие `Update All` и автообновление. В палитре —
  `Extensions: Install Specific Version of Extension...`
  (`workbench.extensions.action.install.specificVersion`): `Select Extension` по установленным
  расширениям из реестра, затем тот же выбор версии, затем открывается страница расширения.
  Доступность — typed when-контекст `extensionsCanInstallSpecificVersion` (`ExtensionVersionContribution`):
  до чтения каталога (на старте в сеть не ходим) считается любое установленное, после — только
  известные реестру; не нашлось — `There are no installed extensions from the marketplace.`, реестр
  недоступен — его ошибка. Команда
  кнопки `workbench.extensions.action.install.anotherVersion` (аргумент — id) без заголовка, в
  палитре её нет.
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
  обновление, удаление, перезагрузка окна переподключением инспектора),
  `e2e/extensionVersionPin.functional.test.ts` / `.cli.test.ts` (пикер версий, откат, закрепление),
  `e2e/extensionsUpdateAll.functional.test.ts` (целевая версия, `Check for Updates`, `@outdated`,
  `Update All`) —
  [TESTING.md](../../TESTING.md#extensions-view-герметичный-сьют).

## Чего сознательно не делаем

- **Дисковый кэш индекса и оффлайн-режим** — заводятся вместе со своей
  инвалидацией и потребителем; пока кэш в памяти на сессию + явный Refresh.
- **Категории, сортировки, рейтинги, «популярное»** — в реестре
  из десятка записей это UI ради UI; `categories` вдобавок нет в мете. Автообновление —
  этап 3 [ExtensionUpdates](../../TODO/ExtensionUpdates.md).
- **Установку из списка одной кнопкой** (inline-кнопка строки в VS Code) —
  установка живёт на странице, чтобы решение принималось после просмотра readme
  и совместимости.
- **Бейдж с числом обновлений на контейнере** (`NumberBadge` эталона на activity bar) — у контейнеров
  нет бейджей; строка в [TODO/Extensions.md](../../TODO/Extensions.md).
- **Inline-кнопка `Update` в строке списка** — тот же довод, что у установки: обновление живёт на
  странице и в `Update All`.
- **Встроенные расширения в `INSTALLED`** — builtin нельзя удалить, в списке они
  были бы мёртвыми строками.
- **Несовместимые версии в пикере** — как эталон, показываем только совместимые (решение Д2);
  точную несовместимую версию ставит CLI `--install-extension id@version`.
