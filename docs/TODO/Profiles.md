# Profiles — профили пользователя (user data profiles)

Статус: `[~]` — итерации 1–2 сделаны, открыты хвосты и итерации 3–4.

Аналог профилей VS Code (`platform/userDataProfile/`, `workbench/services/userDataProfile/`,
`workbench/contrib/userDataProfile/` эталона). Устройство, решения человека и таблица отступлений от
эталона — [arch/Configuration.md](../arch/Configuration.md#профили-user-data-profiles); состав по
профилю у расширений — [arch/Extensions.md](../arch/Extensions.md); хранилища —
[arch/State.md](../arch/State.md). Журнал тестирования итераций — в git (этот файл до волны 3b) и в
PR #601, #602.

- **Итерация 1 (#601)** — реестр и привязки в `User/globalStorage/storage.json`, миграция каталогов
  старых `--profile`, резолв активного профиля (`--profile` → привязка воркспейса → Default), привязка к
  воркспейсу, эталонная семантика настроек именованного профиля, `Profiles: Switch/New/Delete
  Profile...` с перезагрузкой окна, имя профиля в заголовке терминала. e2e —
  `e2e/scenarios/profiles.scenario.ts`.
- **Итерация 2 (#602)** — расширения по профилю: общий каталог, состав — `extensions.json` профиля,
  установка/удаление/CLI с `--profile`, миграция «профиль без файла получает всё». e2e —
  `e2e/scenarios/profileExtensions.scenario.ts`, CLI — `e2e/sea-install.test.ts`.

## Хвосты итераций 1–2

Меняют устройство (`StateFileStore`, магазин), а не саму фичу. Решение человека (13.10.2026):
пользуемся как есть, хвосты ведём здесь задачами.

- [ ] **Два окна на одном `user-data-dir` затирают `storage.json` друг друга.** Каждый процесс держит
  снимок файла и пишет его целиком — свойство `StateFileStore` для всех трёх областей, профили лишь
  сделали его заметным. План: слияние по ключам при записи (`StateFileStore` помнит грязные ключи,
  перед записью перечитывает файл и накладывает только их) плюс перечитывание реестра перед мутацией в
  `UserDataProfilesService`; лок-файл и процесс-владелец — дороже и чужды модели «процесс на терминал».
- [ ] **Битый `storage.json` сбрасывается без резервной копии, `EACCES` на чтении — как пустой** (как в
  эталоне). Та же правка `StateFileStore`: `.corrupt`-копия рядом, нечитаемый не по `ENOENT` файл —
  read-only режим без перезаписи.
- [ ] **Подсказки в settings.json профиля.** Эталон (`handleLocalUserConfiguration`,
  `preferencesRenderers.ts`) гасит `application`-ключ в `settings.json` именованного профиля («This
  setting has an application scope and can only be set in the settings file from the Default
  profile.») и не-`application`-ключи в `User/settings.json`, пока активен именованный. У нас — только
  warn в канал `configuration`. Место — диагностики настроек (`contrib/preferences`,
  `settingsDiagnostics.ts`).
- [x] **Одна версия расширения на все профили** — снято этапом 0 [ExtensionUpdates](ExtensionUpdates.md):
  каталоги `<id>-<version>` лежат рядом, версию профиля решает его `extensions.json` (решение В2 —
  по профилю, как эталон). Остаётся `metadata` записи (pre-release, источник, pinned) — этап 1.
- [x] **Уборка общего каталога расширений на старте** — `.obsolete` и `cleanUpExtensions` в
  `openProfiles`, с арендами живых окон (этап 0 ExtensionUpdates, [Extensions.md](../arch/Extensions.md)).
- [ ] **Отказ удалять расширение, от которого зависят другие** («X depends on this» эталона).
- [ ] `keybindings.json` не перечитывается на лету (было и у Default до профилей) — live-reload как у
  `settings.json`.

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
