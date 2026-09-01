# Marketplace — курируемый магазин расширений

Цель: дать пользователю Diode способ находить и ставить рабочие расширения, а нам —
контролируемый канал их публикации. Магазин курируемый: мы отвечаем за то, что всё
в реестре работает в Diode.

Этот документ — замена старой модели Phase 10 из [Extensions.md](Extensions.md)
(краулер по GitHub-топику `diode-extension`). Что изменилось: **дистрибуция через
курируемый registry-репозиторий** вместо самоподписки топиком — наполнение идёт
PR-ами/коммитами в один репозиторий, а не кравлингом чужих. Что сохранено из старого
дизайна: артефакт/версия-ориентированная схема, `sha256` на каждый артефакт,
матчинг `engines`, install-флоу поверх `installVsix`, миграция на openvsx как
возможное будущее (смена источника, не формата).

Связанные документы: [Extensions.md](Extensions.md) (рантайм расширений; Phase 8b —
views, Phase 9 — внешние расширения), [docs/arch/Extensions.md](../arch/Extensions.md).

## Принципы

- **Курируемость.** В реестр попадает только то, что мы протестировали в Diode.
  Зелёный прогон системы тестирования расширений (§6) — условие добавления/обновления.
- **Байты не хостим.** Запись реестра пинит конкретную версию артефакта по URL +
  `sha256`; сами `.vsix` живут у авторов (openvsx, GitHub Releases). Перехостить
  конкретное расширение можно без смены схемы (другой тип artifact-источника).
- **Иммутабельность версий.** Опубликованная версия не переписывается — изменения
  только добавлением новой версии. Подмену артефакта на том же URL ловит `sha256`.
- **Формат переживает транспорт.** Файловый source, HTTP-source и CI registry-репо
  читают/пишут один формат; код — source of truth
  (`src/vs/platform/extensionManagement/common/registryFormat.ts`).

## Формат данных (schemaVersion 1)

Публикуемый вид registry-репозитория = то, что читает клиентский источник:

```
<registry-root>/
  index.json                 — компактный список для поиска и Extensions view
  meta/<publisher>.<name>.json — полная мета расширения, читается лениво
  artifacts/**               — .vsix для path-артефактов (файловый source/тесты)
```

- `index.json`: `{ schemaVersion, generatedAt?, extensions: [...] }`; запись — `id`
  (строго `publisher.name`), `publisher`, `name`, `displayName`, `description`,
  `kind` (`proxy-openvsx` | `native`), `categories?`, `latest: { version, engines }`
  (чтобы список показывал версию и совместимость без ленивых фетчей).
- `meta/<id>.json`: идентичность + `repository?`/`license?`/`homepage?`/`readme?`
  (inline markdown — контент страницы расширения в табе) + `versions[]`; версия —
  `{ version, engines, artifact, sha256, size?, publishedAt? }`. `engines` обязан
  нести хотя бы одно из `diode`/`vscode`; `sha256` обязателен (hex lowercase).
- Артефакт — union: `{ type: "url", url, origin?: "openvsx" | "github-release" }`
  (origin — provenance, поведение не меняет) или `{ type: "path", path }`
  (POSIX-relative внутри корня; для файлового source).
- Эволюция: `schemaVersion > поддерживаемого` → ошибка «обнови Diode»; опциональные
  поля добавляются без bump'а. Битая запись пропускается с диагностикой, битый файл —
  ошибка (философия `scanExtensions`).

Точные типы и валидация — `registryFormat.ts`; этот раздел — конспект, не копия.

## Статус: шаг 1 (файловый source + install-флоу) — сделан

- [x] Матчинг диапазонов — стоковый `semver` (leaf-зависимость без транзитивного
  хвоста, по правилу GOAL.md). Своя урезанная реализация не годится: `engines`
  прокси-расширений пишем не мы, там встречаются `||`, `1.2.x` и дефисные
  диапазоны, а prerelease по семантике node-semver в диапазон без явного
  запроса не попадает.
- [x] Типы формата + парсеры + `searchRegistryIndex`
  (`platform/extensionManagement/common/registryFormat.ts`).
- [x] `IExtensionRegistrySource` (`getIndex`/`getMeta`/`fetchArtifact`) —
  file/http-взаимозаменяемый шов (`common/iExtensionRegistrySource.ts`).
- [x] Резолв совместимой версии (`common/resolveCompatibleVersion.ts`):
  `engines.diode` ↔ `DIODE_VERSION`, `engines.vscode` ↔ `VSCODE_SHIM_VERSION`
  (лок-степ с `extensions/VSCODE_VERSION`); dev-версия diode не блокирует.
- [x] `FileExtensionRegistrySource` (`node/fileRegistrySource.ts`) — каталог в
  публикуемом формате, только `path`-артефакты.
- [x] `installFromRegistry` (`node/installFromRegistry.ts`): мета → версия →
  артефакт → `sha256` → `installVsix`; защита от id-mismatch с откатом.
- [x] CLI: `--registry <path>` + `--install-extension <id>`; аргумент с суффиксом
  `.vsix` — путь к файлу, всё прочее — id из реестра (различение как у VS Code,
  без обращения к ФС: файл с именем вида id не должен перехватывать установку).
  e2e — `e2e/registry-install.test.ts`.

DI не заводился сознательно: CLI-branch работает до контейнера; сервис-обёртка с
DI-токеном появится вместе с Extensions view (§8).

## Registry-репозиторий и наполнение (следующий шаг)

Отдельный репозиторий `diode-registry`:

- **Source of truth** — `extensions/<publisher>.<name>.json`, по файлу на расширение
  (по сути `meta/<id>.json` без вычислимых полей). PR трогает один файл — нет
  конфликтов между авторами; прямые коммиты — для нас самих.
- **CI-валидация PR:** схема (нашими же парсерами из `registryFormat.ts`), id == имя
  файла, артефакт скачивается, пересчёт и сверка `sha256`/`size`, `engines` — валидный
  semver-диапазон, иммутабельность (изменение опубликованной версии — отказ).
- **Сборка:** CI собирает `index.json` + `meta/` и публикует на GitHub Pages —
  это будущий вход HTTP-источника (§7).

## Прокси-расширения (`kind: "proxy-openvsx"`)

Протестированный нами сток из openvsx: запись пинит конкретную версию URL + `sha256`.
Критерии добавления: расширение реально работает в Diode (заводится через extension
host, ключевые сценарии проходят в системе тестирования §6). Обновление версии =
PR с новой записью в `versions[]` после зелёного прогона на новой версии. Стоковое
расширение может быть заменено нашим форком/патчем позже — это смена артефакта в
новой версии записи, схему не трогает.

## Система тестирования расширений (следующий шаг)

Наша ответственность — «расширение из реестра работает в Diode». Живёт в этом репо,
поверх готовой e2e-инфраструктуры (`e2e/helpers/appSession.ts` уже умеет
`installVsix` реальным CLI):

- Харнесс: поднять каталог файлового реестра → `--registry … --install-extension <id>`
  → запустить редактор → активировать расширение → прогнать smoke-сценарий
  (по образцу `e2e/scenarios/regionFolding.scenario.ts` — дёргать настоящую
  функциональность из пользовательского состояния, не фикстуру).
- Сценарии описываются per-extension (какие команды/провайдеры дёрнуть, что ждать
  на кадре); зелёный прогон — гейт на добавление/обновление записи в реестре.
- Прогон по всему реестру — по расписанию/перед релизом Diode: ловим регрессии
  совместимости нашего же API-шима.

## HTTP-источник (позже)

Второй `IExtensionRegistrySource` поверх published-вида на GitHub Pages: `--registry
<url>` (то же CLI-поле, различение по схеме), кэш `index.json`/`meta` в user-data с
TTL, оффлайн — работа из кэша. HTTP-слоя в `src/` сейчас нет вообще — появится здесь.

## Extensions view (позже)

Как в VS Code, но без иконок; страница расширения открывается в табе:

- Список: `index.json` через источник, поиск — `searchRegistryIndex`, бейдж
  «несовместимо» по `latest.engines`; установленные — `listInstalledExtensions`.
- Страница расширения (таб): рендер `meta.readme` + метаданные + кнопки
  install/uninstall/версии.
- Опора на готовый `ViewsService` (`registerContainer`/`registerView`/`setViewBody`,
  образец — `explorerComponent.ts`); см. [Extensions.md](Extensions.md) Phase 8b.
- Здесь появляется workbench-сервис с DI-токеном (выбор источника из настроек,
  события установки для view) — обёртка над `IExtensionRegistrySource` +
  `installFromRegistry`.

## Безопасность и оговорки

- `sha256` в записи — защита от подмены артефакта по URL (иммутабельность GitHub
  Releases/openvsx неполная); проверка до `installVsix`, mismatch — отказ.
- Защита от id-mismatch: манифест установленного `.vsix` сверяется с запрошенным id,
  расхождение — откат (реестр мог указать чужой артефакт).
- Доверие сосредоточено в курируемом реестре (кто мержит PR — тот и гарант);
  верификация publisher'ов — вопрос настоящих реестров, на нашем масштабе не нужна.
- Момент миграции на openvsx как источник discovery — открыт; формат и
  `IExtensionRegistrySource` делают это сменой источника, не схемы.
