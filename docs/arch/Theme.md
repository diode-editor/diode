# Theme/

Часть архитектуры Vexx — обзорная карта в [../ARCHITECTURE.md](../ARCHITECTURE.md).

Система темизации, совместимая с VS Code theme files. Активная тема — `WorkbenchTheme` за `ThemeService` (`ThemeServiceDIToken`), хранит packed RGB + правила подсветки синтаксиса. Доставка в виджеты — одна точка: `applyThemeVars(root, theme)` кладёт палитру в корневой var-scope TUIDom (подписан WorkbenchComponent), дальше цвета расходятся каскадом токенов ([../STYLES.md](../STYLES.md)); TUIDom про темы так и не знает — он знает про переменные.

> **Правило работы с цветами (единственная система цветов).** Все цвета UI берутся **только** из активной темы через `theme.getColor(key)` / `theme.getRequiredColor(key)`. Никаких цветовых литералов в контроллерах/виджетах и никаких инлайн-фоллбэков. Цвета, которых нет в JSON-темах VS Code (они из code-based color registry), задают наши определения цветов — `Theme/colors/*.ts` (группы по областям + явный merge `COLOR_CONTRIBUTIONS` в `colorContributions.ts`; механика — `ColorRegistry.ts`, аналог `registerColor` из `vs/platform/theme/common/colorRegistry.ts`). Новый цвет добавляется **в одном месте**: определение `{ defaults: { dark, light }, description }` в группе своей области — из него деривируются и типизация ключа (`WorkbenchColorKey`), и таблица дефолтов. Исключение — widget-baseline константы для элементов без темизируемого ключа VS Code.

Enforcement и разрешение цветов:
- `getColor(key) → number | undefined` (опциональные цвета потребитель обрабатывает сам); `getRequiredColor(key) → number` — **кидает**, если цвета нет ни в теме, ни в дефолтах. То есть используемый required-цвет обязан иметь дефолт (покрытие проверяет `colors/colorContributions.test.ts`); genuinely-опциональные ключи объявляются с `defaults: null`.
- `WorkbenchTheme.fromThemeFile(json)` слоит дефолты **под** цвета темы (тема побеждает) и парсит hex→packRgb.
- **Альфа и `blendOver`.** Терминал прозрачности не умеет, поэтому альфа при парсинге отбрасывается, а композитные значения запекаются в hex на месте определения. Проблема в том, что встроенные темы импортированы из upstream **verbatim** и вполне везут `#RRGGBBAA` — у Dark Modern `statusBarItem.hoverBackground: "#F1F1F133"` с отброшенной альфой вырождается в почти белый фон под белым же текстом. На этот случай у определения цвета есть `blendOver: "<ключ подложки>"`: после парсинга полупрозрачное значение накладывается на уже разрезолвленную подложку (`blendRgb`), непрозрачное проходит как есть. Инвариант «и сам blendOver-цвет, и его подложка имеют дефолты» сторожит `colors/colorContributions.test.ts` — на нём стоит отсутствие runtime-проверок в наложении. Носитель на сегодня один — `statusBarItem.hoverBackground` поверх `statusBar.background`.
- `ThemeRegistry` (`ThemeRegistryDIToken`) — реестр тем по label, `resolve`/`list`; точка расширения под `contributes.themes` (см. [../TODO/Theming.md](../TODO/Theming.md)).
- `themes/` — встроенные темы, импортированы **verbatim** из microsoft/vscode и **разреженные**: неопределённые цвета приходят из определений `Theme/colors/`, поэтому дописывать их руками не нужно (перезатрётся при ре-импорте).

Выбор темы: `main.ts` читает `workbench.colorTheme` → `ThemeRegistry.resolve` (неизвестное имя → `DEFAULT_COLOR_THEME`). Рантайм-смена — команда `workbench.action.selectTheme`: quick-pick с **live preview**, Enter применяет и persist'ит через `IConfigurationService.updateUserValue`, Escape откатывает.

**Зависимости:** Theme → Rendering (ColorUtils/packRgb), Common. Находится на одном уровне с Workbench.
