# Стоковые расширения: заметки по конкретным

Что надо знать о конкретных сторонних расширениях, которые работают в Diode: их особенности,
курируемые дефолты, на чём они спотыкались. Общая механика расширений —
[Extensions.md](Extensions.md), магазин — [Marketplace.md](Marketplace.md), конвенция тестов на
сток (расширение берётся из магазина, версию не пиним) —
[TESTING.md](../TESTING.md#тесты-на-стоковые-расширения--из-магазина-конвенция).

## Записи магазина

Критерий записи `proxy-openvsx`: расширение реально работает в Diode, а где есть смоук в
`e2e/marketplace/checks.ts` — он зелёный. Обновление версии — PR с новой записью в `versions[]`;
замена стока нашим форком — смена артефакта в новой версии, схему не трогает. Сьюты, e2e и
сценарии на эти расширения берут их ИЗ МАГАЗИНА.

- **`detachhead.basedpyright`** — смоук: undercurl «is not assignable» на `.py`. Приложение держит
  курируемый дефолт `basedpyright.importStrategy: "useBundled"` (`curatedConfigInjection` в
  `main.ts`) — без него активация падает на API `ms-python.python`; смоук магазина доказывает, что
  дефолт применяется и при установке из реестра.
- **`charliermarsh.ruff`** (#305) — первая запись с **платформенными артефактами**: universal-сборки
  нет, шесть записей одной версии с `targetPlatform` (linux/darwin/win32 × x64/arm64; alpine/armhf
  не включены — таких хостов у diode нет) и гейт `engines.diode`. Внутри vsix — нативный бинарь
  `bundled/libs/bin/ruff`, его исполняемость восстанавливает `installVsix` (exec-бит из
  zip-атрибутов). Курируемый дефолт `ruff.importStrategy: "useBundled"` — детерминированный
  нативный сервер без Python. Смоук — undercurl F401.
- **`dbaeumer.vscode-eslint`** — universal. Расширение НЕ бандлит линтер: eslintServer резолвит
  библиотеку eslint из `node_modules` открытого проекта, поэтому тестовые обвязки доносят её сами
  (`eslintFixture.ts`: кэшируемый `npm install eslint` + симлинк в воркспейс; закоммитить такую
  фикстуру нельзя). Смоук — undercurl `no-extra-semi`; e2e — fix on save.
- **`Catppuccin.catppuccin-vsc`** (#84) — первая цветовая тема: четыре темы через
  `contributes.themes` (Mocha / Macchiato / Frappé — `vs-dark`, Latte — `vs`), `tokenColors` inline,
  141 цвет с альфой из 564 — носитель для композитинга tuidom. Runtime-часть (`dist/main.cjs`,
  перегенерация тем из настроек) не используется: файлы тем читаются из vsix как есть. Смоук —
  `"workbench.colorTheme": "Catppuccin Mocha"` → фон редактора в кадре равен `editor.background` из
  `themes/mocha.json`, тема есть в пикере.
- **`golang.go`** (сайт#19) — universal, гейт `engines.diode: ">=0.9.2"` (до #657 активация падала на
  `vscode.debug`). `support: partial`: отладчика нет, Testing view и code lens'ов пока нет,
  welcome/pprof — webview; требование Go toolchain — пунктом в `limits` и в readme (решение человека,
  как JDK у `redhat.java`). gopls в vsix нет — расширение ставит его само `go install`; смоук кладёт
  заранее собранный gopls в GOBIN (в CI — `.github/actions/go-tools`), без Go кейс пропускается
  (`requires` у чека). Open VSX пишет id как `golang/Go` — см. открытый пункт про регистр id в
  [TODO/Extensions.md](../TODO/Extensions.md#магазин).
- **`Anthropic.claude-code`** (сайт#20) — шесть платформенных vsix по 125–138 МБ (внутри бинарь CLI;
  universal на Open VSX нет). Гейт `engines.diode: ">=0.9.5"` — терминал вкладкой справа (#675),
  `config.*` в when (#676) и `editor/title` (#677); решение человека — запись опубликована до
  релиза, у 0.9.4 она «несовместима», dev-сборки ставят. Лицензия проприетарная — в `license`
  дословная строка манифеста, байты не хостим. `support: partial`: webview-чат, `Ctrl+Esc` только с
  kitty-протоколом; нужен `claude` CLI в PATH — терминальный режим набирает голое `claude`, вшитый
  бинарь не использует. Смоук — пункт статус-бара, лок с `ideName: "Diode"` и MCP `initialize`
  пробным клиентом (настоящий CLI не запускается — [TESTING.md](../TESTING.md)).
- **`EditorConfig.EditorConfig`** — прокси на сток; смоук — `[*.tabbed] indent_size=3` применяется.
  **`maptz.regionfolder`** — на Open VSX не опубликован, немодифицированный vsix перевыложен в
  `artifacts/` реестра (`kind: "proxy-hosted"`, MIT).
