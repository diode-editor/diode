# Profiles — профили пользователя (user data profiles)

Аналог профилей VS Code (`platform/userDataProfile/`, `workbench/services/userDataProfile/`,
`workbench/contrib/userDataProfile/` эталона, `node scripts/vscode-ref.mjs`): у человека
несколько наборов настроек/кейбиндов/состояния, профиль привязан к воркспейсу, переключается
командой из палитры. До этой работы профиль был только флагом `--profile <name>` с каталогом
`User/profiles/<name>/` и наследовал **все** настройки Default-профиля — реестра, привязок и
команд не было.

Устройство слоёв настроек — [docs/arch/Configuration.md](../arch/Configuration.md), хранилища —
[docs/arch/State.md](../arch/State.md), состав фичи — `src/vs/workbench/contrib/userDataProfile/`.

## Итерация 1 — минимальный срез (сделано, #601)

- [x] P1 модель и реестр: `platform/userDataProfile/common/userDataProfile.ts` —
  `IUserDataProfile { id, name, isDefault, location, settingsResource, keybindingsResource,
  globalStorageHome, extensionsResource }`, `IUserDataProfilesService { defaultProfile, profiles,
  onDidChangeProfiles, createNamedProfile, updateProfile, removeProfile, setProfileForWorkspace,
  getProfileForWorkspace }`, токен `IUserDataProfilesServiceDIToken` рядом с типом;
  `platform/userDataProfile/node/userDataProfilesService.ts` — хранение через `StateService`.
- [x] P2 хранение — application-уровень `StateService` (`scope: "application"`, файл
  `<userDataDir>/User/globalStorage/storage.json`, вне профиля), ключи как в эталоне:
  `userDataProfiles: [{ name, location }]` (`location` относительно `User/profiles/`) и
  `profileAssociations: { workspaces: { "<путь>": "<id>" } }`.
- [x] P3 миграция: каталоги `User/profiles/<name>/`, которых нет в реестре, регистрируются на старте
  как профили с `name` = имя каталога (идемпотентно, каждый старт).
- [x] P4 резолв активного профиля на старте: `--profile <name>` → привязка текущего воркспейса →
  Default. `--profile` с неизвестным именем создаёт пустой профиль; с открытым воркспейсом —
  привязывает его (описание флага у эталона, `platform/environment/node/argv.ts`).
- [x] P5 привязка — **к воркспейсу**: ключ — путь файла `.code-workspace`, если окно открыто
  из него, иначе путь папки (`workspace.configuration ?? folders[0]`, как
  `userDataProfileManagement.ts` эталона). Хранится путь, не хэш, — `profileAssociations`
  читается глазами. Пустое окно привязки не имеет.
- [x] P6 семантика настроек — как в эталоне: `settings.json` именованного профиля **заменяет**
  пользовательский слой; из `User/settings.json` (Default) в именованный профиль приходят только
  ключи со `scope: "application"`; такие ключи в файле профиля игнорируются (warn в лог
  `configuration`), а их запись из именованного профиля идёт в `User/settings.json`.
  Keybindings уже standalone (грузится только `keybindings.json` профиля).
- [x] P7 команды палитры с ID и названиями эталона (`workbench/contrib/userDataProfile/browser/userDataProfile.ts`):
  `Profiles: Switch Profile...` (пикер, текущий — `$(check)`; пишет привязку воркспейса и
  перезагружает окно), `Profiles: New Profile...` (имя → «Empty» / «Copy from current» → создать,
  привязать, перезагрузить), `Profiles: Delete Profile...` (мультивыбор; удалённый текущий → окно
  перезагружается в профиль воркспейса, то есть Default).
- [x] P8 имя профиля в заголовке окна: `window.title` у нас нет; заголовок терминала (OSC 2)
  собирается как `${rootName} - ${profileName} - Diode` — подмножество дефолта `window.title`
  эталона (`${profileName}` пуст у Default). Сам ключ `window.title` — не поддержан (см. ниже).
- [x] P9 Open Folder / Open Workspace from File внутри сессии: привязка нового воркспейса
  пересчитывается **до** смены папки (обёртка опенера `UserDataProfileWorkspaceOpener`); профиль
  другой — папка не трогается, окно перезагружается уже с новым воркспейсом в аргументах (иначе
  человек оставался бы в чужом профиле); Cancel в «Save changes?» оставляет окно в прежней папке
  и профиле. e2e: `e2e/scenarios/profiles.scenario.ts`.
- [x] P10 перезагрузка окна несёт явные аргументы следующего окна (`--profile <имя>` и, при
  смене воркспейса, его путь вместо прежних позиционных): без этого `--profile` из исходного
  `argv` перебивал бы только что записанную привязку, а Open Folder + reload возвращал бы прежнюю
  папку. Супервизор (`base/node/restartProcess.ts`) читает аргументы следующего окна из файла
  (`DIODE_RELAUNCH_FILE`), который окно пишет перед выходом с `RELOAD_EXIT_CODE`.
- [x] P11 расширения в этой итерации **общие для всех профилей** — временное отступление
  (эталон: `extensions.json` профиля). Снято итерацией 2.

### Отступления от эталона (итерация 1)

| Что | Эталон | У нас | Цена / мотив |
|---|---|---|---|
| id профиля | случайный hex (`hash(generateUuid())`), каталог `profiles/<id>` | slug из имени (`[A-Za-z0-9._-]`, прочее → `-`, не длиннее 64; пусто или одни точки → `profile`; имя устройства Windows `con`/`nul.txt`/… → префикс `profile-`; коллизия без учёта регистра и с зарезервированным `default` → суффикс `-2`), каталог `profiles/<slug>` | каталог читается глазами и совпадает с тем, что `--profile <name>` создавал раньше; переименование (`updateProfile`) **не** переезжает каталог — id перестаёт совпадать с именем (решение человека) |
| переключение профиля | в локальном окне — перезапуск extension host без перезагрузки окна | перезагрузка окна (профиль фиксирован на процесс, `IEnvironmentService`) | горячего переключения нет; цена — reload, как у remote-окна эталона |
| привязка Default | `workspaces[ws] = "__default__profile__"` пишется и для Default | привязка к Default = запись снимается (нет записи ⇔ Default) | файл короче; резолв тот же |
| каталоги профилей без записи в реестре | `cleanUp()` на старте **сносит** их | регистрируются как профили (миграция старых `--profile`) | без этого старые профили пропали бы; `removeProfile` сносит каталог сразу (эталон — на следующем старте) |
| пустое окно | привязка `emptyWindows` по id окна | привязки нет: профиль пустого окна — `--profile` либо Default; после reload — тот, с которым окно работало (`--profile <имя>` в аргументах перезапуска) | итерация 3 |
| `window.title` | настройка с переменными, title bar | терминальный заголовок (OSC 2) из `rootName`, `profileName`, `Diode`; ключа нет | отдельная задача, если понадобятся остальные переменные |
| `Delete Profile...` | precondition `HAS_PROFILES_CONTEXT` | команда всегда в палитре; без именованных профилей — пикер не открывается | контекст-ключ — вместе с Profiles editor |
| `New Profile...` | Profiles editor: имя, иконка, «Copy from» (текущий/шаблоны), галочки ресурсов | два шага в quick input: имя → «Empty» / «Copy from current» (settings + keybindings) | editor — итерация 4 |
| `application`-ключ в settings.json именованного профиля | редактор настроек гасит ключ с подсказкой «can only be set in the settings file from the Default profile» (`handleLocalUserConfiguration`); не-`application`-ключи `User/settings.json` гасятся при активном именованном | ключ не действует, назван warn'ом в канале `configuration` (один раз на набор ключей); подсказок в JSON нет, `User/settings.json` из именованного профиля не валидируется | подсказки — вместе с валидацией settings.json в редакторе (отдельная задача) |

Не поддержанные настройки эталона (названы в PR): `window.newWindowProfile` (нового окна нет),
`workbench.settings.applyToAllProfiles` (итерация 3), `window.title` (см. выше).

### Принятые решения (человек)

- Семантика настроек именованного профиля — эталонная (свой `settings.json` + `application`-ключи
  Default), а не наследование всего.
- Id профиля — slug из имени; отступление записано выше.
- Переключение — через перезагрузку окна.
- Реестр — в `User/globalStorage/storage.json`, как в эталоне.
- Привязка — к воркспейсу (`.code-workspace` приоритетнее папки); `--profile` тоже привязывает.

### Хвосты итераций 1–2 (открыто)

Из отчёта тестировщика ниже и из таблиц отступлений; в итерациях 1–2 не чинилось, потому что
меняет устройство (`StateFileStore`, движок, магазин), а не саму фичу профилей. Решение человека
(13.10.2026): пользуемся как есть, хвосты ведём здесь задачами.

- [ ] **Два окна на одном `user-data-dir` затирают `storage.json` друг друга** (находка 5). Каждый
  процесс держит снимок файла и пишет его целиком — свойство `StateFileStore` для всех трёх
  областей, профили лишь сделали его заметным (реестр и привязки). План: слияние по ключам при
  записи (`StateFileStore` помнит грязные ключи, перед записью перечитывает файл и накладывает
  только их) плюс перечитывание реестра перед мутацией в `UserDataProfilesService`; лок-файл и
  процесс-владелец — дороже и чужды модели «процесс на терминал».
- [ ] **Битый `storage.json` сбрасывается без резервной копии, `EACCES` на чтении — как пустой**
  (находка 15; как в эталоне). Та же правка `StateFileStore` для всех областей: `.corrupt`-копия
  рядом, нечитаемый не по `ENOENT` файл — read-only режим без перезаписи.
- [ ] **Подсказки в settings.json профиля** (находка 10). Эталон (`handleLocalUserConfiguration`,
  `preferencesRenderers.ts`) гасит `application`-ключ в `settings.json` именованного профиля
  («This setting has an application scope and can only be set in the settings file from the Default
  profile.») и не-`application`-ключи в `User/settings.json`, пока активен именованный профиль. У нас —
  только warn в канал `configuration`; `User/settings.json`, открытый из именованного профиля, не
  валидируется вовсе. Место — диагностики настроек (`contrib/preferences`, `settingsDiagnostics.ts`).
- [ ] **Заголовок окна в tmux не ставится** (находка 8) — правка в tuidom: `writeOscSequence`
  заворачивает OSC в DCS passthrough, а tmux сам понимает OSC 0/2 и ждёт прямой вывод.
- [ ] **Заголовок терминала не восстанавливается после выхода** (находка 11) — push/pop заголовка
  (`CSI 22;0t` / `CSI 23;0t`) поддержан не всеми терминалами; решить, ставить ли пустой заголовок
  на прощании (vim делает push/pop).
- [ ] **Одна версия расширения на все профили** (отступление итерации 2): обновил в одном профиле —
  обновилось во всех. Эталон держит каталоги `<id>-<version>` рядом и учитывает версию в
  `extensions.json` профиля; у нас `version` в файле справочный. Вместе с этим — `metadata`
  записи (pre-release, источник, pinned).
- [ ] **Уборка общего каталога расширений на старте** (`deleteExtensionsNotInProfiles` эталона):
  сейчас мусор убирается только в момент удаления из последнего профиля и при удалении профиля;
  каталог, положенный в `extensions/` руками, не удаляется и в профиль не попадает.
- [ ] **Отказ удалять расширение, от которого зависят другие** («X depends on this» эталона) —
  сейчас удаляется, зависимое не поднимается на активации.
- [ ] `keybindings.json` не перечитывается на лету (не к профилям, было и у Default до них) —
  live-reload как у `settings.json`.

Для changelog / описания PR: `--profile default` раньше открывал Default-профиль, теперь (как в
эталоне, поиск по имени с учётом регистра) создаёт именованный профиль `default` с каталогом
`profiles/default-2`.

### Тестирование итерации 1

Живой редактор (`npm run -s drive -- …`, сессия переживает reload: `exec …` → `wait reload`),
файлы `user-data-dir/user-data/User/` на диске, заголовок терминала — diode из исходников в
отдельном tmux-сервере (`tmux -L difftest`, `#{pane_title}`), запись `application`-ключа и
`inspect()` — скриптом поверх настоящего `loadConfiguration` (в UI нет команды, пишущей
`application`-ключ). В примерах `d` = `npm run -s drive --`, `$U` = `<user-data-dir>/user-data/User`.

#### Находки (по серьёзности)

**1. Критично, исправлено — имя `..`/`.` уводит каталог профиля из `profiles/`; Delete сносит `User/`.**
Slug `..` проходил `PROFILE_ID_PATTERN`, `location` = `profiles/..` = `User/`.
`d exec workbench.profiles.actions.createProfile` → `..` → Empty: запись `{"name":"..","location":".."}`
в реестре, команда падает в лог `Profile '..' does not exist` (id при загрузке — `basename` = `User`),
окно не перезагружается. Затем `Delete Profile...` → отметить `..` → Enter: **`$U` удалён целиком** —
`settings.json` Default, все `profiles/*`, кейбинды (остался только `globalStorage/`, пересозданный
записью состояния). Имя `.` — то же с `profiles/` (удаление сносит все профили). Ожидание: каталог
профиля всегда внутри `profiles/`.
Починка: `PROFILE_ID_PATTERN` не пускает `.`/`..` (и в `--profile`/`resolveUserDataPaths`), slug из одних
точек → `profile`; `removeProfile` сносит каталог, только если он прямой потомок `profiles/`;
запись реестра с относительным `location`, не являющимся id (`..`, `../x`, `default`), пропускается с warn.
Тесты: `userDataProfile.test.ts`, `userDataProfilesService.test.ts`, `userDataPaths.test.ts`. Вживую
после починки: `..` → каталог `profiles/profile`, удаление `User/settings.json` не трогает.

**2. Высокая, исправлено — профиль с именем `default` молча работает на файлах Default.**
`New Profile...` → `default` → Empty: id `default`, а `resolveUserDataPaths` считает `default`
маркером Default-профиля → «пустой» профиль показывает `Spaces: 7` из `$U/settings.json`, пишет туда же
(то же — `--profile default`, и каталог `profiles/default`, если он есть, при миграции).
Починка: id `default` зарезервирован (`RESERVED_PROFILE_ID`, из него же `DEFAULT_PROFILE_NAME`
путей): slug даёт `default-2`, миграция каталог `default` пропускает с warn. Вживую: `default` →
`profiles/default-2`, `Spaces: 4`.
Замечание: прежний diode понимал `--profile default` как Default; теперь, как в эталоне (поиск
по имени с учётом регистра), это новый профиль `default` — стоит упомянуть в changelog.

**3. Высокая, исправлено — после Open Folder без перезагрузки Switch Profile / Reload Window
поднимают стартовую папку и привязывают к профилю её.**
`d start` (папка `workspace/`, Default) → `Open Folder...` → `F3` (без привязки — тот же Default,
перезагрузки нет, верно) → `Switch Profile...` → `new-one`: окно поднялось в **`workspace/`** (из argv),
в `profileAssociations` появились и `F3 → new-one`, и **`workspace → new-one`** (лишняя привязка
чужой папки). Просто `Reload Window` после того же Open Folder тоже возвращал стартовую папку.
Починка: следующее окно получает текущий воркспейс, если он сменился после старта
(`relaunchWorkspace` в `cliArgs.ts`, зовётся из `restart` в `main.ts`), тест в `cliArgs.test.ts`.
Вживую: Open Folder F3 → New Profile → окно в F3, привязка только у F3.

**4. Высокая, исправлено — Open Folder в папку другого профиля + Cancel в «Save changes?» оставлял
окно в новой папке со старым профилем.**
`d start --arg --profile --arg new-one` → `New Untitled File`, набрать текст → `Open Folder...` → `F2`
(без привязки, Default): дерево уже показывает `F2`, затем диалог «Do you want to save…» →
`Cancel`: окно остаётся в **F2 с профилем `new-one`** — ровно рассогласование, от которого P9
защищает (настройки F2 пишутся в `new-one`). `Don't Save` — корректно: reload в F2 + Default.
Причина: `setWorkspaceFolder` менял воркспейс до перезагрузки, подтверждение — уже после. В эталоне
смена воркспейса и есть перезагрузка окна, подтверждение — до неё.
Починка: профиль решается до смены воркспейса — `UserDataProfileWorkspaceOpener` оборачивает
опенер `WorkbenchComponent` (`WorkspaceFolderOpenerDIToken`, `workbenchModule`): профиль цели
другой → `reloadWindow({ profile, workspace })` без `setWorkspaceFolder`; тот же → смена папки как
есть. Contribution на `onDidChangeWorkspaceFolders` снята — механизм один. Тесты:
`userDataProfileWorkspaceOpener.test.ts` (в том числе Cancel и отказ пути перезагрузки).

**5. Высокая, НЕ исправлено (нужно решение по устройству) — два окна diode на одном user-data-dir
затирают реестр/привязки друг друга.**
`d start -s t3` (Default) и `d start -s t4 --arg --user-data-dir --arg <тот же>`; в t3 `New Profile...`
→ `A` (привязка `t3/workspace → A`); в t4 пикер `A` не видит; t4 `Switch Profile...` → любой →
в `storage.json` привязка t3 **откатилась** к прежнему значению (`t3/workspace → default`). Каждый
процесс держит свой снимок `storage.json` и переписывает файл целиком (последний пишущий побеждает);
профиль `A` вернулся только благодаря миграции каталога. У эталона писатель один — main-процесс; у
нас процесс на терминал, и параллельные окна — обычный случай. Варианты: перечитывать файл перед
мутацией реестра и сливать по ключам; лок-файл; отдельный процесс-владелец.

**6. Средняя, исправлено — id различаются только регистром (`Work`/`work`/`WORK` — три профиля).**
На Linux — три каталога, на macOS/Windows — **один** (общие файлы, удаление одного сносит остальные).
Починка: занятость id сравнивается без учёта регистра (`work` при `Work` → `work-2`).

**7. Средняя, исправлено частично — длинное имя (300 символов) → `ENAMETOOLONG` при mkdir, команда
падает только в лог.** Починка: slug режется до 64 символов. Общая проблема молчаливых отказов — п. 9.

**8. Средняя, НЕ исправлено (нужна правка tuidom) — в tmux заголовок окна не ставится.**
`tmux -L x new-session "diode --profile Work myproj"` → `#{pane_title}` = имя хоста. `writeOscSequence`
бэкенда tuidom оборачивает OSC 0 в DCS-passthrough tmux: при дефолтном `allow-passthrough off` он
отбрасывается, при `on` уходит во внешний терминал, а не в заголовок панели. OSC 0/2 tmux понимает
сам (как у shell'ов/vim) — нужен прямой вывод, а `writeDirect` у `NodeTerminalBackend` приватный → PR
в tuidom (публичный `setTitle`/`writeDirect`). Вне tmux (`env -u TMUX`) заголовок верный, см. ниже.

**9. Средняя, исправлено — отказы команд профилей были молчаливы.** Ошибка `createNamedProfile`
(ENAMETOOLONG, EACCES на mkdir, до починки — `does not exist` у `..`) была видна только в логе
`[commands] command "workbench.profiles.actions.createProfile" failed`; пользователь видел, что
ничего не произошло. Эталон показывает ошибку уведомлением (`notificationService.error`).
Починка: New/Switch показывают тост с текстом ошибки и отдают отказ дальше (запись в логе команд
остаётся); Delete — тост, как и было. Тесты в `userDataProfileActions.test.ts`.

**10. Средняя, НЕ исправлено — нет подсказок в settings.json профиля; отступление записано в таблицу.**
Эталон (`handleLocalUserConfiguration`, `preferencesRenderers.ts`) гасит `application`-ключ в
`settings.json` именованного профиля («This setting has an application scope and can only be set in
the settings file from the Default profile.») и не-`application`-ключи в `User/settings.json`, пока
активен именованный профиль. У нас — только warn в канал `configuration`; `User/settings.json`, открытый
из именованного профиля, не валидируется вовсе (ни подсказок, ни Unknown Setting).

**11. Низкая — заголовок терминала не восстанавливается после выхода**: после `Ctrl+Q` у панели
остаётся `myproj - Work - Diode` (vim и др. делают push/pop заголовка `CSI 22;0t`/`CSI 23;0t`).

**12. Низкая, исправлено — Copy from current ломал отступ соседней строки**: при вырезании последнего
ключа (`terminal.integrated.colorSource`) `jsonc` `modify` оставлял `"editor.detectIndentation": false`
без отступа. Причина: опции форматирования (4 пробела) не совпадали с отступом файла (2), а комментарий
перед ключом расширял переформатируемый диапазон. Починка: отступ берётся из файла (`formattingOptionsOf`).

**13. Низкая, исправлено — warn про `application`-ключ в файле профиля повторялся на каждой записи в
этот файл** (`toProfileLayer` при `updateValue`). Теперь — один раз на набор ключей; снова — когда набор
изменился или ключ вернулся после исчезновения.

**14. Низкая, исправлено — имена `con`, `nul`, `aux`… давали id — зарезервированные имена Windows**,
`mkdir` там упал бы. Такой slug (и с расширением: `nul.txt`) получает префикс `profile-` на любой ОС —
реестр общий.

**15. Низкая (как в эталоне) — битый `storage.json` сбрасывается в `{}` и перезаписывается** на первой
записи без резервной копии (лог `Corrupt state file … resetting {}`); нечитаемый не по ENOENT (EACCES)
считается пустым — при доступной записи следующая запись затрёт содержимое.

Не к профилям: `keybindings.json` не перечитывается на лету (и у Default, было и раньше); в
`npm run test` упал `extensionHost.javaLsp.test.ts` (стоковый redhat.java, активация) — см. гейты.

#### Проверено и прошло

- P1–P3: реестр и привязки в `$U/globalStorage/storage.json` (`userDataProfiles` с относительным
  `location`, `profileAssociations.workspaces` путём); миграция `profiles/legacy` без записи →
  профиль `legacy` (лог `Registered 1 existing profile folder(s)`), идемпотентно.
- P4: `--profile P` с папкой — создан, привязан; повторный старт той же папки без флага → `P`;
  `--profile A` на старте, затем Switch → `Copy of P` → после reload активен новый; привязка на
  отсутствующий в реестре id → Default; профиль из реестра без каталога — каталог создаётся при входе.
- P5: две `.code-workspace` над одной папкой и сама папка — три независимые привязки
  (`a.code-workspace → A`, `b.code-workspace → B`, папка — Default); Open Workspace from File в
  `b.code-workspace` из `A` → reload в Default.
- P6: из именованного профиля не видны `window`-ключи `User/settings.json` (`Spaces: 4` против `7`);
  правка `profiles/P/settings.json` на диске подхватывается на лету (`Spaces: 3`); `application`-ключ в
  файле профиля игнорируется с warn в `output configuration`; тот же ключ из `User/settings.json` виден;
  `updateValue` `application`-ключа из именованного профиля пишет в `User/settings.json`, обычного — в
  файл профиля; `inspect`: в именованном `{default, user: <application из Default>, profile}`, в Default —
  `user`. Open User Settings (JSON) / Keyboard Shortcuts (JSON) открывают файлы профиля, сохранение
  пишет в `profiles/P/keybindings.json`, кейбинд действует после reload.
- P7: три команды в палитре с id и названиями эталона; Switch — `$(check)` у текущего, Esc —
  `storage.json` не меняется, выбор текущего — no-op без reload; New → Empty (каталог без файлов) /
  Copy from current (settings без `application`-ключей + keybindings, warn после копии нет); Delete —
  мультивыбор, «Current» у текущего, удаление текущего и всех именованных разом → reload в Default,
  привязки удалённых к другим воркспейсам сняты, каталоги удалены; без именованных — пикер не открывается.
- P8 (вне tmux): `myproj - Diode` (Default), `myproj - Work - Diode`, `web (Workspace) - Diode`,
  `web (Workspace) - Work - Diode`, пустое окно — `Diode`, кириллица `myproj - Мой профиль - Diode`.
- P9: Open Folder в папку другого профиля без грязных вкладок и с `Don't Save` → reload с новой папкой
  в её профиле; в папку того же профиля — без reload.
- P10: процессов после каждого reload ровно супервизор + окно (+ extension host); после `stop` — ни одного.
- P11: расширения общие — ожидаемо.
- Изоляция: открытые вкладки папки в Default и в `A` раздельны (`workspaceStorage` профиля); `storage.json`
  отсутствует / битый (лог `Corrupt state file`) / только для чтения (`EACCES` в канале Profiles) /
  `globalStorage` недоступен — старт не падает, причина в логе.

#### Гейты

- `npm run lint`, `npm run typecheck`, `npm run valid-layers-check` — зелёные (до правок и после).
- `npm run test` — 12949 зелёных, 1 красный файл-пара: `extensionHost.javaLsp.test.ts` /
  `extensionHost.javaLsp.features.test.ts` (стоковый `redhat.java` из магазина не активируется,
  `hasExtension(JAVA_ID)` = false). **Не регресс фичи**: на копии дерева `HEAD` (`git archive HEAD`, без
  правок профилей) падает так же — поломка окружения/свежей версии расширения, нужна отдельная задача.
- e2e `profiles.scenario.ts` (`npm run test:e2e -- e2e/scenarios-{1..4}.test.ts -t profiles`, бинарь
  из кэша по дереву с правками 1–7) — зелёный.
- `npm run test:mutation` — 100% по скоупу (3 фантома, перепроверены вживлением). Запуск с
  `DIODE_E2E_OFFLINE=1`: без него initial run Stryker'а падает на тех же тестах `redhat.java`. Первый
  прогон после правок нашёл 2 настоящих выживших — ставшую избыточной проверку пустого `location` в
  `isValidStoredProfile`, она убрана.

## Итерация 2 — расширения по профилю (сделано, #602)

Каталог расширений один на установку (`<userData>/extensions/`, `--extensions-dir`), а профиль
решает только состав — `extensions.json` (`platform/extensionManagement/node/profileExtensions.ts`,
аналог `extensionsProfileScannerService.ts` эталона). Устройство — [docs/arch/Extensions.md](../arch/Extensions.md).

- [x] E1 состав профиля: у именованного — `User/profiles/<id>/extensions.json`, у Default —
  `<extensionsDir>/extensions.json` (`getDefaultProfileExtensionsLocation` эталона,
  `defaultProfileExtensionsResource` у `UserDataProfilesService`). Формат — подмножество записи
  эталона: `[{ "identifier": { "id" }, "version", "relativeLocation" }]`; чужие поля записи
  (`location`, `metadata`) при перезаписи сохраняются, id сравниваются без учёта регистра.
- [x] E2 скан на старте поднимает только расширения активного профиля: темы, языки, грамматики,
  конфигурация и extension host видят один и тот же отфильтрованный набор. Профиль фиксирован на
  процесс, смена профиля — перезагрузка окна, поэтому отдельный перезапуск extension host не
  нужен: новый процесс сканирует состав нового профиля (проверено вживую, см. ниже).
- [x] E3 установка из магазина и `--install-extension` кладут расширение в общий каталог и
  включают в состав активного профиля — вместе с `extensionDependencies`, в том числе теми, что уже
  лежали на диске для другого профиля. CLI работает с профилем `--profile <имя>` (неизвестное имя —
  ошибка `Profile '<имя>' not found.`), без флага — с Default (`cliProcessMain` эталона);
  `--list-extensions` печатает состав профиля.
- [x] E4 удаление (Uninstall в магазине, `--uninstall-extension`) убирает расширение из профиля, а
  с диска — когда его нет ни в одном `extensions.json` (`onDidRemoveExtensions` эталона). Файлы
  «всех профилей» — реестр плюс каталоги `User/profiles/*` на диске: реестр процесса может не
  знать профиль, созданный соседним окном. Нечитаемый файл любого профиля — с диска не удаляется
  ничего.
- [x] E5 `Profiles: Delete Profile...` уносит и расширения, которые больше никому не нужны (лог
  `Deleted extensions no profile uses` в канале Extensions).
- [x] E6 `Profiles: New Profile...` → «Empty» — пустой состав (`[]` пишется при создании профиля,
  в том числе `--profile <новое имя>`), «Copy from current» — копия `extensions.json` текущего.
- [x] E7 миграция: профиль без `extensions.json` (Default и именованные из версий, где расширения
  были общими) на старте окна и CLI получает **все** установленные расширения — файл пишется один
  раз. **Решение:** у именованных — «всё», а не «пусто», как у эталона для нового профиля: в 0.8.x
  человек видел все расширения в каждом профиле, и после обновления у него ничего не пропадает.
  Новый профиль файл получает сразу, поэтому «нет файла» значит только «профиль из прошлой
  версии» (или файл удалён руками — тогда тоже «всё»).
- [x] E8 e2e: `e2e/scenarios/profileExtensions.scenario.ts` (миграция сида → Copy from current →
  Empty → установка в пустой профиль → Default без неё), CLI с `--profile` — `e2e/sea-install.test.ts`.

### Отступления от эталона (итерация 2)

| Что | Эталон | У нас | Цена / мотив |
|---|---|---|---|
| версия расширения в профилях | у каждого профиля своя версия, каталоги `<id>-<version>` сосуществуют | одна версия на все профили: установка сносит прочие версии id, запись профиля сопоставляется с диском по id, `version`/`relativeLocation` в файле — справочные | обновил расширение в одном профиле — обновилось во всех, где оно есть; без этого нужен учёт версий по профилям и уборка по версиям |
| уборка общего каталога | на каждом старте `deleteExtensionsNotInProfiles` сносит всё, чего нет ни в одном профиле | сразу при удалении из последнего профиля и при удалении профиля; на старте — нет | каталог, положенный в `extensions/` руками после миграции, не удаляется (но и в профиль не попадает — как у эталона, ставьте `--install-extension`) |
| профиль без `extensions.json` | пустой состав | при старте получает все установленные (E7), файл пишется | обновление с 0.8.x ничего не прячет; новый профиль получает `[]` явно |
| запись `extensions.json` | `location` (URI) + `relativeLocation` + `metadata` | `identifier`, `version`, `relativeLocation`; чужие поля сохраняются | `metadata` (pre-release, источник, pinned) у нас нет |
| удаление расширения, от которого зависят другие | отказ «X depends on this» | удаляется, зависимое не поднимется на активации (как и раньше) | не менялось этой итерацией |

### Проверено вживую (итерация 2)

`npm run drive` из исходников, `--install <hello-lang.vsix>`, реестр-фикстура с `test.sample-lang`:
CLI-установка записалась в `extensions/extensions.json` (Default), `.hello` — «Hello Language»;
New Profile → `clean` → Empty → после reload `profiles/clean/extensions.json` = `[]`, `.hello` —
«Plain Text», в магазине нет секции INSTALLED; Install `Sample Lang` → запись только в
`profiles/clean/extensions.json`; reload → `.diodesample` — «Diode Sample» (host поднял состав
профиля); Switch → Default → «Hello Language», `Sample Lang` в INSTALLED нет; New Profile → `copy`
→ Copy from current → состав Default скопирован; Delete Profile `clean` → `test.sample-lang`
удалён с диска (`Deleted extensions no profile uses`), `test.hello-lang` остался.

## Итерация 3 — ресурсы профиля и флаги

- [ ] `useDefaultFlags` (settings/keybindings/extensions/…): ресурс профиля берётся из Default.
- [ ] `workbench.settings.applyToAllProfiles` — ключи, которые читаются из Default во всех профилях.
- [ ] snippets / tasks / prompts / mcp в модели профиля (по мере появления самих фич).
- [ ] привязка пустого окна (`emptyWindows`) — чтобы `diode` без папки помнил профиль.
- [ ] `window.newWindowProfile` — когда появится «новое окно».

## Итерация 4 — UI и перенос

- [ ] Profiles editor (`workbench.profiles.actions.manageProfiles`): переименование с переездом
  каталога либо честным расхождением id/имени, иконка, ресурсы галочками.
- [ ] Export / Import профиля (`.code-profile`), `--profile-temp` (transient-профили).
- [ ] Горячее переключение без перезагрузки окна (требует профиль вне `IEnvironmentService`).
