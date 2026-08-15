# Темизация (color themes)

**Статус**: встроенные темы + пикер со сменой темы готовы. Осталось — темы от расширений (`contributes.themes`) и live-reload по изменению `workbench.colorTheme` в settings.json.

Issues: #83 (взять расцветку как в VS Code), #84 (плагины смены расцветки), #85 (встроенные темы + возможность их менять).

Архитектура и готовое — см. [arch/Theme.md](../arch/Theme.md) и [arch/Configuration.md](../arch/Configuration.md).

```
IThemeFile (JSON, 1:1 c VS Code)
   │  scripts/import-vscode-themes.mjs (verbatim из microsoft/vscode)
   ▼
themes/*.ts ──▶ ThemeRegistry (label → IThemeFile) ──▶ resolve(label) ──▶ WorkbenchTheme
                                                                              │
   workbench.colorTheme (Configuration) ──▶ выбор активной ──▶ ThemeService ──┤ onThemeChange
                                                                              ▼
                              WorkbenchComponent / ThemedComponent-наследники … updateStyles()
```

## Осталось (подфичи)

### [ ] Темы от расширений (`contributes.themes`) — «плагины расцветки» (#84)
Сейчас `ThemeRegistry` сидится только встроенными темами. VS Code-расширения (напр. `theme-monokai-dimmed`, One Dark Pro и т.п.) вкладывают темы через `contributes.themes: [{ label, uiTheme, path }]`.

**План:**
1. Раскомментировать `contributes.themes` в `IExtensionManifest` (`src/vs/platform/extensions/**`) — типизация уже есть закомментированной.
2. Контрибьютор по аналогии с `ExtensionTokenizationContributor`: `ThemeContributor.apply()` проходит `contributes.themes`, читает `path` через `IAssetAccess`, парсит JSONC (резолв `include` уже есть в импорт-скрипте — вынести в рантайм-хелпер `resolveThemeInclude`), кладёт `IThemeFile` в `ThemeRegistry.register`.
3. `uiTheme` (`vs`/`vs-dark`/`hc-black`/`hc-light`) → `IThemeFile.type`.
4. Пикер уже читает `ThemeRegistry.list()` — новые темы появятся автоматически.
5. **Тесты:** тестовое расширение с темой в `TestUtils` harness; проверить, что тема регистрируется и резолвится.

**Риск/вопрос владельцу:** темы расширений грузятся асинхронно (как грамматики). Если `workbench.colorTheme` называет тему из ещё не отсканированного расширения — на старте будет fallback на дефолт, а тема подхватится позже. Нужен ли hot-swap активной темы при поздней регистрации (по аналогии с hot-swap токенайзера)? Для MVP — нет; тема применится со следующего запуска.

### [ ] Live-reload при ручной правке `workbench.colorTheme`
`onDidChangeConfiguration` — no-op (watcher настроек не реализован, общий пробел Configuration-слоя). Когда появится watcher — подписать `main.ts`/`WorkbenchComponent` на изменение `workbench.colorTheme` и звать `ThemeService.setTheme(registry.resolve(...))`. Пока смена руками в settings.json подхватывается перезапуском (пикер persist'ит без перезапуска).

### [ ] Раскомментировать недостающие ключи `IWorkbenchColors`
Импортированные темы несут ~сотни цветовых ключей; `IWorkbenchColors` большинство держит закомментированными. Незаявленные ключи парсятся в модель, но типобезопасного `getColor` для них нет. Раскомментировать по мере того, как виджеты начинают их использовать (как и задумано в слое Theme).

## Связанные файлы
- `src/vs/workbench/services/themes/common/themeRegistry.ts`, `src/vs/workbench/services/themes/common/themes/*` — реестр и встроенные темы
- `scripts/import-vscode-themes.mjs` — импорт тем из microsoft/vscode
- `src/vs/workbench/browser/parts/quickinput/quickInputService.ts` — `quickPick()` list-pick flavor
- `src/vs/workbench/Actions/ThemeActions.ts` — `selectColorTheme` (экшен-пикер), меню — `MenuService`
- `src/vs/platform/configuration/node/configurationService.ts` — `updateUserValue` (persist)
- `src/vs/diode/main.ts` — выбор активной темы на старте
