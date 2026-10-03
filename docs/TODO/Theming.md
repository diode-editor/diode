# Темизация (color themes)

**Статус**: встроенные темы, пикер со сменой темы, live-reload по правке `workbench.colorTheme` и темы от расширений (`contributes.themes`, установка темы из магазина) готовы. Открыто — подсветка текущей строки (`editor.lineHighlightBackground`, часть US-18) и группировка пикера по типу темы.

Issues: #83 (взять расцветку как в VS Code), #84 (плагины смены расцветки), #85 (встроенные темы + возможность их менять).

Архитектура и готовое — см. [arch/Theme.md](../arch/Theme.md) и [arch/Configuration.md](../arch/Configuration.md).

```
IThemeFile (JSON, 1:1 c VS Code)
   │  scripts/import-vscode-themes.mjs (verbatim из microsoft/vscode)
   ▼
themes/*.ts ──▶ ThemeRegistry (label → IThemeFile) ──▶ resolve(label) ──▶ WorkbenchTheme
                    ▲                                                          │
   contributes.themes расширений (ExtensionThemeContributor, на старте) ────────│
                                                                               │
   workbench.colorTheme (Configuration) ──▶ выбор активной ──▶ ThemeService ──┤ onThemeChange
                                                                               ▼
                              WorkbenchComponent: applyThemeVars → корневой var-scope → каскад
```

## Сделано

- [x] Встроенные темы (Dark Modern, Dark+, Dark 2026, Light Modern, Light+, Monokai) — verbatim-импорт из microsoft/vscode.
- [x] Пикер `workbench.action.selectTheme` с live preview, persist в `workbench.colorTheme`.
- [x] Live-reload при ручной правке `workbench.colorTheme` в settings.json — `ThemeConfigContribution` (`contrib/themes/browser/themeConfigContribution.ts`).
- [x] Альфа в цветах (tuidom 0.4.0): `#RRGGBBAA` уходит в палитру как есть, композитинг — в движке; `blendOver` снят. Выделение — токен `editor.selectionBackground` (дефолты VS Code `#264F78`/`#ADD6FF`) вместо литерала.
- [x] Темы от расширений — `ExtensionThemeContributor` (`services/extensions/common/`), регистрация до первого кадра; постановка и чек-лист ниже.
- [x] Тень оверлеев как возможность движка (tuidom 0.5.0: `TUIElement.shadow` / `OverlaySessionOptions.shadow`, токен `widget.shadow`): TUI-аналог `box-shadow` попапов VS Code — колонка справа и строка снизу композитятся с тем, что под оверлеем. В diode объявлен только цвет `widget.shadow` (дефолты VS Code), у оверлеев тень **не включена** — рамки меню для тем без неё решены в #358; включать точечно, если решим (`shadow: true` в опциях сессии).

## [x] Темы от расширений — установка темы из магазина (#84)

**Сделано**: шаг 0 (tuidom 0.4.0, альфа), `contributes.themes` в манифесте, контрибьютор с JSONC/`include`/`uiTheme`, порядок старта «сканирование → темы → выбор активной», e2e `extensionTheme.test.ts` (US-3/5/7/8), сценарий-демо `extensionTheme.scenario.ts` (US-1/6), юниты контрибьютора (US-4, US-11…US-17), смоук магазина на Catppuccin (US-19; запись в реестре сайта — PR в `diode-editor.github.io`).

Отклонения от чек-листа, зафиксированные при реализации:
- **US-18, подсветка текущей строки** — в редакторе нет отрисовки `editor.lineHighlightBackground` (отдельная фича, `editor.renderLineHighlight`), поэтому «едва заметный оттенок под кареткой» не показывается. Выделение и hover списков — как в постановке: `editor.selectionBackground` с альфой ложится на фон строки патчем, `list.hoverBackground` — каскадом.
- **Снапшоты встроенных тем** не изменились: у Dark+ (тема тестов) оба цвета с альфой (`editor.selectionHighlightBackground`, `tab.selectedForeground`) виджетами не читаются; `statusBarItem.hoverBackground` Dark Modern композитится движком в те же числа, что раньше давал `blendOver`.
- Правило painter'а из STYLES.md применено в редакторе: фон декорированной строки и фон зоны композитятся с `editor.background` один раз до многопроходной отрисовки (`compositeOver`), иначе полупрозрачный токен лёг бы вторым слоем под текстом.

### Постановка

Сегодня магазин ([Marketplace.md](Marketplace.md), [ExtensionsView.md](ExtensionsView.md)) умеет
поставить любое расширение, но расширение-тема после установки **ничего не делает**:
`contributes.themes` в `IExtensionManifest` закомментирован, контрибьютора нет,
`ThemeRegistry.register` никто кроме сидирования встроенных не зовёт. Пользователь ставит
One Dark Pro, перезагружает окно, открывает пикер — и видит те же шесть встроенных тем.

Цель задачи: **тема из магазина проходит тот же путь, что и любое расширение** — установка →
`Reload Window` → тема в пикере и в `workbench.colorTheme`, без отдельных ручек. Формат —
VS Code (`contributes.themes: [{ label, uiTheme, path }]`, файл темы — JSON/JSONC с
`colors`/`tokenColors`/`include`), чтобы стоковые темы с open-vsx работали без правок.

**Предпосылка — альфа в движке (сделано, tuidom 0.4.0).** Стоковые темы массово используют
`#RRGGBBAA` (Catppuccin Mocha: 141 из 564 цветов), а diode альфу отбрасывал и латал точечным
`blendOver`. С tuidom 0.4.0 цвет с альфой — штатное число (`packRgba`, `parseHexColor`
`#RGBA`/`#RRGGBBAA`), композитинг выполняет движок в порядке отрисовки
(`Grid.updateCell` + каскад; [STYLES.md, «Модель цвета»](https://github.com/tuidom/tuidom/blob/main/docs/STYLES.md)).
Задача начинается с шага 0: поднять `@tuidom/*` до `^0.4.0`, отдавать в палитру RGBA как есть
(и в `tokenColors`), удалить `blendOver` и отбрасывание альфы в `workbenchTheme.ts`/`colorUtils.ts`.

Не входит: `contributes.iconThemes` / `productIconThemes` (иконок файлов у нас нет), горячее
появление темы без перезагрузки окна (модель магазина — «установил → Reload Window», решение 2
в ExtensionsView.md), `semanticTokenColors`/`semanticHighlighting` (семантических токенов в
редакторе нет — поле игнорируется), `workbench.colorCustomizations`.

### Принятые решения

1. **Ключ темы — `label` из манифеста**, не `name` внутри JSON. Так делает VS Code: в
   `workbench.colorTheme` попадает `label`, и настройка, перенесённая из VS Code, совпадёт
   с нашей. `name` из файла игнорируется. Тема без `label` или без `path` пропускается с
   записью в лог (философия `scanExtensions`: битая запись — пропуск, а не падение).
2. **Файлы тем читаются на старте, все и до первого кадра.** Грамматики у нас ленивые, потому
   что их 6.6 MB; файл темы — десятки килобайт, расширение несёт 1–10 тем. Чтение всех
   тем параллельно перед выбором активной даёт синхронный `resolve` (пикер применяет
   тему на каждую стрелку, ему нужен `IThemeFile` в памяти) и **отсутствие «мигания»**:
   если `workbench.colorTheme` называет тему расширения, первый кадр уже в ней, а не в
   Dark Modern с последующим перекрасом. Это снимает «риск/вопрос владельцу» из старого
   плана: hot-swap при поздней регистрации не нужен, потому что поздней регистрации нет.
3. **Порядок в `main.ts`: сканирование расширений → регистрация тем → выбор активной.**
   Сейчас тема выбирается (строка ~209) раньше сканирования (~237); блок переезжает ниже.
   Сканирование и так await'ится до первого кадра, стоимость — чтение нескольких JSON.
4. **Коллизии label** — последняя регистрация побеждает (уже так в `ThemeRegistry`), порядок:
   встроенные → builtin-расширения → пользовательские. Совпадение label двух
   пользовательских расширений — warning в лог, побеждает последнее по порядку скана.
5. **Пропавшая тема — откат на дефолт, настройку не трогаем.** Расширение удалили или оно
   не сканируется — `workbench.colorTheme` остаётся, активной становится
   `DEFAULT_COLOR_THEME` (уже так), плюс запись в лог с именем ненайденной темы.
   Пользователь, поставивший расширение обратно, получает свою тему без действий; это и
   поведение VS Code.
6. **`include` резолвится в рантайме** относительно файла темы, через `IAssetAccess` того же
   расширения; слияние — как в `scripts/import-vscode-themes.mjs` (`colors` — object-merge,
   `tokenColors` — конкатенация base-first). Цикл или отсутствующий include — тема
   пропускается с ошибкой в лог. Общая функция слияния `mergeThemeFiles(base, child)`
   выносится в `platform/theme/common/`; импорт-скрипт остаётся отдельным (он `.mjs` и
   тянет файлы из GitHub на этапе сборки), но повторяет ту же семантику — на это тест.
7. **`uiTheme` → `IThemeFile.type`**: `vs` → `light`, `vs-dark` → `dark`, `hc-black` → `hc`,
   `hc-light` → `hcLight`; отсутствует или неизвестен — `dark` с warning.
8. **`tokenColors` строкой (путь к `.tmTheme`, plist XML) — не поддерживается в этой задаче**:
   тема регистрируется с цветами workbench и пустым `tokenColors` (подсветка — из дефолтов
   `Theme/colors`), в лог — warning. Современные темы с open-vsx (One Dark Pro, Dracula,
   Catppuccin, GitHub Theme) держат правила inline; plist-парсер — отдельная задача, если
   в реестре появится такая тема.

### Пользовательские сценарии

Приёмочный чек-лист. Герметичные сценарии закрываются на **синтетическом расширении-теме**
(фикстура в `TestUtils` / `e2e/fixtures`, vsix пакуется продовым `scripts/pack-vsix.mjs`,
установка — через файловый реестр-фикстуру `e2e/helpers/registryFixture.ts`); стоковая тема
приезжает **из магазина** по конвенции [TESTING.md](../TESTING.md#тесты-на-стоковые-расширения--из-магазина-конвенция).
Каждый сценарий с видимой частью доходит до кадра: ассерт — цвет ячейки фона редактора /
статус-бара равен `editor.background` / `statusBar.background` темы, а не «в реестре есть
запись».

#### Установка и появление темы

- **US-1. Поставить тему из магазина.** В реестре расширение-тема (`test.sample-theme` с
  темами `Sample Dark` и `Sample Light`), окно открыто. → Вьюлет `EXTENSIONS` → страница
  расширения → `Install` → `Reload Window`. → После перезагрузки в пикере `Color Theme`
  есть `Sample Dark` (`dark`) и `Sample Light` (`light`) вслед за встроенными; выбор
  `Sample Dark` перекрашивает окно: фон редактора и статус-бара — цвета из файла темы.
- **US-2. Поставить из CLI.** → `diode --install-extension test.sample-theme`, затем
  обычный запуск. → То же, что US-1: темы в пикере, применяются.
- **US-3. Тема из настроек стартует без мигания.** Установлено `test.sample-theme`, в
  settings.json `"workbench.colorTheme": "Sample Dark"`. → Запустить Diode. → **Первый**
  кадр уже в `Sample Dark` (в headless-прогоне — первый захваченный кадр, а не «в итоге»);
  в статус-баре нет промежуточного Dark Modern.
- **US-4. Настройка, перенесённая из VS Code.** В settings.json стоит `label` темы, как его
  пишет VS Code (`"One Dark Pro Darker"`), при этом `name` внутри JSON темы другой. →
  Запустить. → Тема найдена по `label` из манифеста; `name` из файла ни на что не влияет.
- **US-5. Тема ещё не установлена.** В settings.json `"workbench.colorTheme": "Sample Dark"`,
  расширения нет. → Запустить. → Окно в `Dark Modern`, настройка не переписана, в логе
  `Color theme "Sample Dark" not found, falling back to "Dark Modern"`. → Поставить
  расширение, `Reload Window`. → Окно в `Sample Dark` без каких-либо действий с настройками.

#### Пикер и смена

- **US-6. Live preview работает для тем расширений.** Пикер открыт. → Стрелками пройти
  через `Sample Dark`, `Sample Light`, `Monokai`. → Каждый шаг перекрашивает окно
  синхронно (без «догоняющего» кадра); `Escape` возвращает исходную тему; `Enter` на
  `Sample Light` persist'ит `"workbench.colorTheme": "Sample Light"`.
- **US-7. Live-reload из settings.json.** Установлено `test.sample-theme`. → Руками
  вписать `"workbench.colorTheme": "Sample Light"` и сохранить. → Окно перекрасилось без
  рестарта (тот же `ThemeConfigContribution`, регистрация темы — из того же реестра).
- **US-8. Подсветка синтаксиса — из темы.** Активна `Sample Dark`, у неё в `tokenColors`
  правило `keyword` → приметный цвет. Открыт `.ts`. → Кадр. → Ключевое слово `const`
  окрашено цветом из правила темы; после переключения на `Dark Modern` — цветом Dark Modern.

#### Удаление, обновление, конфликты

- **US-9. Удалить расширение с активной темой.** Активна `Sample Dark`. → Страница
  расширения → `Uninstall` → `Reload Window`. → Окно в `Dark Modern`, `Sample *` из пикера
  ушли, в settings.json по-прежнему `"Sample Dark"` (US-5), запись в логе.
- **US-10. Обновить расширение-тему.** Стоит `test.sample-theme@0.0.1` (`Sample Dark`
  с одним фоном), в реестре `0.0.2` (другой фон + новая тема `Sample Dimmed`). → `Update
  to 0.0.2` → `Reload Window`. → Фон — из 0.0.2, в пикере три темы; старой версии на
  диске нет.
- **US-11. Тема расширения с label встроенной.** Расширение объявляет `label: "Monokai"`. →
  Запустить, открыть пикер. → В пикере один `Monokai` — из расширения (последняя
  регистрация побеждает), в логе warning о затенении.
- **US-12. Два расширения с одним label.** → Запустить. → В пикере одна запись, побеждает
  последнее по порядку скана, warning в лог с обоими id.

#### Формат файла темы

- **US-13. `include` внутри расширения.** `Sample Dimmed` — `{ "include": "./sample-dark.json",
  "colors": { "editor.background": … } }`. → Применить. → Фон — из `Sample Dimmed`, остальные
  цвета и `tokenColors` — из `sample-dark.json`.
- **US-14. JSONC.** Файл темы с комментариями и висячими запятыми (так публикуют многие
  темы). → Применить. → Читается.
- **US-15. Битый файл темы не роняет ни расширение, ни старт.** У расширения три темы, у
  одной невалидный JSON, у другой `path` ведёт в никуда, у третьей цикл `include`. →
  Запустить. → Приложение стартовало, в пикере остальные темы этого расширения (если есть)
  и все встроенные, по каждой битой — ошибка в логе с id расширения, label и причиной.
  Если битая тема — активная по настройке, откат на дефолт (US-5).
- **US-16. `uiTheme` определяет группу.** `vs` / `vs-dark` / `hc-black` / `hc-light`. →
  Пикер. → Подписи `light` / `dark` / `high contrast` / `high contrast light`; `uiTheme`
  отсутствует → `dark`.
- **US-17. `tokenColors` строкой (`.tmTheme`).** → Применить. → Цвета workbench применены,
  подсветка — дефолтная, warning в логе «tmTheme tokenColors are not supported». Тема при
  этом в пикере есть (решение 8).
- **US-18. Полупрозрачные цвета.** Catppuccin Mocha: `editor.lineHighlightBackground:
  #cdd6f412`, `editor.selectionBackground: #9399b240`, `list.hoverBackground: #31324480`. →
  Применить, поставить курсор на строку, выделить фрагмент, навести на строку списка. →
  Кадр: подсветка строки — едва заметный оттенок фона редактора (не белая плашка), выделение
  поверх подсветки — смесь смеси, hover в списке — полутон. Значения ячеек совпадают с
  `compositeOver(цвет, подложка)` из `@tuidom/core`. Встроенные темы после снятия
  `blendOver` выглядят так же, как до (снапшоты не меняются).

#### Магазин

- **US-19. Стоковая тема из публичного реестра.** В `diode-editor.github.io` опубликована
  запись `proxy-openvsx` для `Catppuccin.catppuccin-vsc` (Catppuccin Mocha / Macchiato / Frappé /
  Latte; артефакт open-vsx + sha256). →
  `--install-extension <id>` → запуск → пикер. → Темы расширения в списке, выбор
  перекрашивает окно. Смоук в `e2e/marketplace/checks.ts`: установка по id → тема в
  реестре → фон редактора равен `editor.background` из файла темы.

### Устройство

0. `@tuidom/*` → `^0.4.0` (между 0.2.1 и 0.4.0 — 0.3.0: `probeTerminalVersion`, CSI u,
   modifyOtherKeys; смотреть changelog релизов). В `platform/theme/common/`: парсинг hex через
   `parseHexColor` из `@tuidom/core`, альфа сохраняется; `blendOver` и второй проход в
   `workbenchTheme.ts` удалить, определения цветов с `blendOver` упростить; токен-тема
   синтаксиса тоже несёт RGBA. Painter'ы, которые заливают область и затем пишут текст тем
   же цветом, передают в `drawText` непрозрачный bg из `resolvedStyle`/`getCell`, а не токен
   с альфой (правило STYLES.md) — проверить редактор, терминал, списки.
1. Раскомментировать `themes?: readonly IThemeContribution[]` в `IExtensionManifest`
   (`platform/extensions/common/iExtensionManifest.ts:113`); `IThemeContribution =
   { id?, label, uiTheme, path }` — как в VS Code.
2. `ExtensionThemeContributor` (`workbench/services/extensions/common/`, по образцу
   `ExtensionTokenizationContributor`): `apply(): Promise<void>` проходит
   `contributes.themes` всех расширений, читает `path` через `IAssetAccess` (виртуальный
   путь — `joinVirtualPath(ext.location, path)`), парсит JSONC, резолвит `include`
   (`mergeThemeFiles`), маппит `uiTheme` → `type`, кладёт `{ ...file, name: label }` в
   `ThemeRegistry.register`. Ошибки одной темы — лог + пропуск. Возвращает Disposable,
   снимающий регистрации (под будущую выгрузку) — для этого `ThemeRegistry` получает
   `unregister(label)`.
3. `main.ts`: блок «Реестр встроенных тем + выбор активной» переезжает после
   `mergeExtensions`; `await contributor.apply()` до `resolve(colorThemeLabel)`. Ненайденная
   тема — лог через `extensionsLogger`.
4. Пикер (`themeActions.ts`) и `ThemeConfigContribution` менять не нужно — оба читают реестр.
5. JSONC — стоковый `jsonc-parser` с `allowTrailingComma`, как в `LanguageConfigurationService`
   и `keybindingsService`; своего парсера не заводим.

### Проверка

- Юниты контрибьютора колокацией: синтетическое расширение в `ExtensionTestHarness` с темами
  на каждый формат-сценарий (US-11…US-17), проверка `ThemeRegistry.list()/resolve()` и логов.
  Юнит на `mergeThemeFiles` против эталона `scripts/import-vscode-themes.mjs` (одинаковый
  результат на цепочке Dark Modern → Dark+ → Dark VS).
- Тест продюсера порядка старта: `AppTestHarness` с пользовательским расширением-темой и
  `workbench.colorTheme` на неё — **первый** кадр в цвете темы (US-3).
- e2e-сценарий-демо `e2e/scenarios/extensionTheme.scenario.ts` (обязателен по
  [PR.md](../PR.md)): файловый реестр-фикстура с `test.sample-theme` → Install → Reload
  Window → пикер → применение → кадр (US-1, US-6, US-9).
- Смоук магазина на стоковую тему в `e2e/marketplace/checks.ts` (US-19) — после публикации
  записи в реестре сайта; до публикации US-19 не гейтит PR.
- `npm run test:mutation` перед сдачей ([AGENTS.md](../../AGENTS.md), «Что считать готово»).

### Открытые вопросы

- ~~Кандидат для реестра~~ — решено: **Catppuccin** (`Catppuccin.catppuccin-vsc`, четыре темы
  через `contributes.themes`, `tokenColors` inline, без `include`; целевая тема — Catppuccin
  Mocha) публикуется в реестр в рамках этой задачи, смоук магазина — на неё (US-19).
- **Подсветка текущей строки** (`editor.lineHighlightBackground`, US-18) — отдельная фича редактора; токен объявлен без дефолта и виджетами не читается.
- **Показ в пикере.** VS Code группирует темы разделителями по типу (dark / light / hc); у нас
  тип — подпись справа. С ростом списка за счёт расширений группировка может понадобиться —
  отдельная правка пикера, здесь не делаем.
- **`.tmTheme`** — заводить plist-парсер только если такая тема попросится в реестр.
- **Иконки** (`iconThemes`, `productIconThemes`) — отдельная задача, когда появится
  носитель иконок в Explorer.

### [ ] Раскомментировать недостающие ключи `IWorkbenchColors`
Импортированные темы несут ~сотни цветовых ключей; `IWorkbenchColors` большинство держит закомментированными. Незаявленные ключи парсятся в модель, но типобезопасного `getColor` для них нет. Раскомментировать по мере того, как виджеты начинают их использовать (как и задумано в слое Theme).

## Связанные файлы
- `src/vs/workbench/services/themes/common/themeRegistry.ts`, `src/vs/workbench/services/themes/common/themes/*` — реестр и встроенные темы
- `src/vs/workbench/contrib/themes/browser/themeActions.ts` — `selectColorTheme` (экшен-пикер)
- `src/vs/workbench/contrib/themes/browser/themeConfigContribution.ts` — live-reload по `workbench.colorTheme`
- `src/vs/workbench/services/extensions/common/extensionThemeContributor.ts` — контрибьютор `contributes.themes` (чтение, `include`, `uiTheme`, регистрация); `platform/theme/common/themeFileParser.ts` — разбор JSONC-файла темы, `platform/theme/common/mergeThemeFiles.ts` — слияние `include`
- `src/vs/platform/extensions/common/iThemeContribution.ts` — тип записи `contributes.themes`
- `scripts/import-vscode-themes.mjs` — импорт тем из microsoft/vscode (та же семантика слияния `include`, что у `mergeThemeFiles`)
- `src/vs/diode/main.ts` — порядок старта: сканирование расширений → регистрация их тем → выбор активной
- `e2e/fixtures/sample-theme/` — синтетическое расширение-тема (`test.sample-theme`: Sample Dark / Light / Dimmed) для e2e и сценария; `e2e/marketplace/checks.ts` — смоук на `Catppuccin.catppuccin-vsc`
