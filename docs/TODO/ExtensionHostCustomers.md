# Нарезка ExtensionHost: состояние спавна и customers (G1)

Статус: `[x]` сделано.

`ExtensionHost` (`services/extensions/node/extensionHost.ts`, ~2800 строк)
держит в одном классе три вещи с разным временем жизни: процесс и канал
(spawn, ready, shutdown), реестр и активацию расширений (живут, пока жив хост)
и около дюжины поверхностей API, чьё состояние должно жить ровно один спавн
субпроцесса. Время жизни поверхностей нигде не выражено: сброс при смерти
субпроцесса — ручной список `resetSubprocessState()`, и каждая новая поверхность
обязана сама вспомнить про него. Отсюда целый класс ошибок «забыли дописаться
в сброс».

Как в vscode: `ExtensionHostManager` на каждый спавн строит набор customers
(`mainThread*`), а смерть хоста — это `dispose()` всего набора
(`services/extensions/common/extensionHostManager.ts`). Переносим без
декораторов и без типизации RPC (это G4): контракт `attach(ctx): IDisposable`,
явный массив customers, `ExtensionHost` остаётся фасадом с прежним публичным API.

## План

1. [x] Состояние спавна (#476) (`spawnStore`) и исправления латентных ошибок сброса:
   подписки спавна на ядро снимаются на смерти (не копятся на респавне),
   watcher'ы расширений снимаются на смерти, канал мертвеца закрывается, а
   оборванная смертью активация возвращается к оживлению. Тест на точную
   последовательность семян handshake — страховка для переносов ниже.
2. [x] `ExtensionHostProcess` (#484) — spawn/ready/shutdown/kill/stdio отдельно от хоста
   (аналог `LocalProcessExtensionHost`).
3. [x] Контракт (#490) `IExtensionHostCustomer` + первые customers без состояния
   (secrets, env: clipboard/openExternal).
4. [x] window-customer (#491): progress, statusBar, output, diagnostics, quickInput,
   messages — handle'ы и их очистка уезжают в attach/dispose.
5. [x] decorations + тема (#494).
6. [x] filesystem-customer (#497) (FS-схемы, text-content, watcher'ы); отдельным
   коммитом — сброс объявленных схем на смерти с событием.
7. [x] commands (#499) (прокси на спавн, заглушки-активаторы долгоживущие).
8. [x] editor + configuration (#500).
9. [x] documents (#501) (save, sync, семя didOpen) + порт `IDocumentSyncTarget` для
   `bindDocumentSync`.
10. [x] language features: реестр провайдеров спавна (#502), затем запросы к ним и
    батчеры (#504).
11. [x] стоки окна в `api/common` (адаптеры `api/browser` без импортов слоя
    node); опустевший `resetSubprocessState` → `endSpawn` (#505).
12. [x] `ExtensionPhases` (#506) — таблица фаз расширений с юнит-тестами (G8 заберёт её
    в сервис расширений).
13. [x] Доки: `docs/arch/Extensions.md` (фасад и customers, смерть субпроцесса),
    `docs/ARCHITECTURE.md`.

## Не делаем

ProxyIdentifier и типизацию RPC (G4), дедуп `provide*` (G5), дельты document
sync (G3), перенос реестра и активации в сервис (G8), слияние customers с
`api/browser/*Adapter` в upstream-образные `mainThread*`.
