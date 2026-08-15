# DI-контейнер

Реализация: `src/vs/platform/instantiation/common/diContainer.ts`.

Строго типизированный DI-контейнер на основе токенов. Без декораторов, без reflect-metadata, работает с `--erasableSyntaxOnly` / strip types.

## Основные примитивы

- `Token<T>` — типизированный ключ для сервиса
- `token<T>(id)` — фабрика токенов
- `Injectable<T, Deps>` — тип класса со `static dependencies`
- `Container` — контейнер с lazy singleton resolution

## Именование токенов

Все DI-токены именуются по конвенции `{ServiceName}DIToken`:

- `EditorServiceDIToken` — токен для `EditorService`
- `TuiApplicationDIToken` — токен для `TuiApplication`
- `WorkbenchComponentDIToken` — токен для `WorkbenchComponent`

Не используем префикс `I` (как `IEditorCtrl`) — только суффикс `DIToken`.

## Где объявлять токены

**Токен объявляется рядом со своим типом** — в том же файле, что и класс/интерфейс, к которому он ведёт, либо в соседнем файле `*DIToken.ts` того же каталога (образец: `src/vs/platform/configuration/common/iConfigurationServiceDIToken.ts`). Слой токена = слой типа: токен platform-сервиса живёт в platform, editor-фичи — в editor, workbench-сервиса — в workbench.

Отдельного списка «слоёв, где можно DI» нет — его заменяет ось зависимостей: импорт токена подчиняется тем же правилам слоёв, что и любой другой импорт. Проверяет `npm run valid-layers-check`, включая правило «файл с `token<T>()` берёт `T` из своего слоя или ниже» — токен не может вести к типу из слоя выше себя.

Нижняя граница: **`tuidom/` токенов не объявляет и `diContainer` не импортирует** — движок не тянет DI-модель Diode (кандидат на отдельный репозиторий; сторож — в `check-layers`).

Сквозные токены ядра, у которых нет файла-владельца (`TuiApplicationDIToken`, `TerminalBackendDIToken`, `ClipboardDIToken` и др.), живут в `src/vs/workbench/common/coreTokens.ts`. Размещение там части сервисных токенов — наследие прежнего правила «токены только в workbench»; новые токены туда не добавлять, объявлять рядом с типом.

## Объявление токенов

```typescript
import { token } from "../../platform/instantiation/common/diContainer.ts";

export const EditorServiceDIToken = token<EditorService>("EditorService");
```

## Объявление зависимостей в классе

Класс объявляет `static dependencies` — кортеж токенов, соответствующий параметрам конструктора.
Компилятор проверяет, что типы токенов совпадают с типами параметров:

```typescript
import { StatusBarServiceDIToken } from "../Services/StatusBarService.ts";
import { ThemeServiceDIToken } from "../../Theme/ThemeTokens.ts";

export class StatusBarComponent extends ThemedComponent {
    static dependencies = [StatusBarServiceDIToken, ThemeServiceDIToken] as const;

    constructor(statusBar: StatusBarService, themeService: ThemeService) {
        super(themeService);
        // ...
    }
}
```

Если зависимостей нет:

```typescript
export class StatusBarService extends Disposable {
    static dependencies = [] as const;

    constructor() {
        super();
    }
}
```

## Регистрация в контейнере

Контейнер конфигурируется в точке входа (`main.ts`). Одна строка на сервис:

```typescript
import { Container } from "./Common/DiContainer.ts";

const container = new Container()
    .bind(TuiApplicationDIToken, () => application) // фабрика для leaf-сервисов
    .bind(EditorServiceDIToken, EditorService)      // класс — deps из static dependencies
    .bind(WorkbenchComponentDIToken, WorkbenchComponent);

const workbench = container.get(WorkbenchComponentDIToken);
```

Два варианта `.bind()`:
- **Класс** — `bind(token, Class)` — контейнер читает `Class.dependencies` и резолвит автоматически
- **Фабрика** — `bind(token, () => value)` — произвольная логика создания

## Что проверяет компилятор

При `bind(token, Class)` TypeScript проверяет:
- Тип `Token<T>` совпадает с типом экземпляра класса
- Массив `static dependencies` соответствует параметрам конструктора: количество, порядок, типы

Ошибка компиляции если:
- Перепутан порядок зависимостей
- Пропущена или лишняя зависимость  
- Тип токена не совпадает с типом параметра
- Токен привязан к классу неправильного типа

## Что проверяется в рантайме

- Отсутствие биндинга → `Error: No binding for "ServiceName"`
- Циклическая зависимость → `Error: Circular dependency detected: A → B → A`

## Singleton-семантика

Все биндинги — lazy singletons. Первый вызов `get(token)` создаёт экземпляр, последующие возвращают кешированный.

## Прямое создание без контейнера

Классы остаются plain — `static dependencies` не влияет на конструктор.
В тестах можно создавать экземпляры напрямую:

```typescript
const component = new StatusBarComponent(fakeStatusBarService, themeService);
```

## Модули и профили

Чтобы избежать копипасты конфигурации в каждой точке входа (`main.ts`, тесты,
демо), биндинги группируются в **модули** — функции вида
`(container, ctx) => void`. Модули собираются в **профили** — фабрики готовых
контейнеров под конкретный сценарий (production, test).

Файлы: `src/vs/diode/modules/` (исключение — `terminalEnvironmentModule`, живёт рядом со своим сервисом в `src/vs/workbench/Services/TerminalEnvironment/`).

### `ContainerModule<Ctx>`

```typescript
export type ContainerModule<Ctx = void> = (container: Container, ctx: Ctx) => void;
```

Модуль регистрирует группу связанных по смыслу сервисов. Опциональный `Ctx` —
типизированный конфиг (например, `{ theme }` или `{ clipboard }`). Применяется
через `.use()`:

```typescript
const container = new Container()
    .use(coreModule, { app })
    .use(commandsModule)
    .use(themeModule, { theme })
    .use(workbenchModule);
```

`.use()` возвращает контейнер — его можно чейнить с обычным `.bind()`.

### Существующие модули

| Модуль | Контекст | Что регистрирует |
|--------|----------|------------------|
| `coreModule` | `{ app }` | `ServiceAccessor`, `TuiApplication` |
| `coreModuleLate` | — | Только `ServiceAccessor`. Для тестов, где `TuiApplication` создаётся позже от view корневого компонента. |
| `commandsModule` | — | `CommandRegistry`, `KeybindingRegistry`, `ContextKeyService` |
| `themeModule` | `{ theme }` | `ThemeService` |
| `tokenizationModule` | `{ tokenizationRegistry, tokenStyleResolver, languageService }` | Соответствующие токены. Реализации передаются снаружи. |
| `backendModule` | `{ clipboard }` | `Clipboard` |
| `backendModuleDefault` | — | `Clipboard` с `InMemoryClipboard` по умолчанию |
| `configurationModule` | `{ configurationService, configurationRegistry }` | `IConfigurationService` (готовый экземпляр из `loadConfiguration(paths, …, registry)`) + `ConfigurationRegistry` (реестр схем настроек) |
| `configurationModuleDefault` | — | `NULL_CONFIGURATION_SERVICE` + настоящий `ConfigurationRegistry` из `CONFIGURATION_CONTRIBUTIONS` (тесты и demo) |
| `stateModule` | `{ stateService }` | `IStateService` — машинное состояние UI/сессии (готовый экземпляр из `loadState(paths)`; см. [arch/State.md](arch/State.md)) |
| `stateModuleDefault` | — | `IStateService` с `NULL_STATE_SERVICE` (тесты и demo) |
| `loggingModule` | `{ logService }` | `ILogService` (production-экземпляр из `main.ts`) |
| `loggingModuleDefault` | — | `ILogService` с `NULL_LOG_SERVICE` (тесты) |
| `extensionHostModule` | — | `ExtensionHost` (+ адаптеры: `EditorOptionsServiceAdapter`/`EditorDecorationsServiceAdapter` поверх `EditorService` (Workbench), `FileDecorationsServiceAdapter` поверх `ExplorerService` (Workbench), `ThemeColorResolverAdapter` поверх `ThemeService`) |
| `workbenchModule` | — | Пары Service ↔ Component слоя Workbench: `StatusBarService`+`StatusBarComponent`, contribution'ы статус-бара (`EditorStatusContribution`, `TerminalEnvStatusContribution`), `KeybindingDispatcher`, `DialogService`, `LifecycleService`; Panel-кластер — `PanelService`+`PanelComponent`, `ProblemsComponent`, `TerminalService`+`TerminalPanelComponent` (+ прод-фабрика `TerminalSessionFactory` → `EmbeddedTerminalSession`), `DiagnosticsService`; Explorer-кластер — `ExplorerService`+`ExplorerComponent`, `FileOperationsService`, `InputWidgetService`; QuickInput-кластер — `QuickInputComponent` (общий виджет), `QuickInputService`, `FileSearchService`, quick-access-провайдеры (`Files`/`Commands`/`GotoLine` + явный список `QUICK_ACCESS_PROVIDERS` и `QuickAccessRegistry`), `QuickOpenService`; Editor-кластер — `EditorService`+`EditorGroupComponent`; Find/Suggest-кластер — `FindService`+`FindComponent` и `CompletionService`+`SuggestComponent`; Shell-кластер (этап 11) — `LayoutService`, `WorkbenchStateService`, `WorkbenchContextKeys`, `MenuRegistry`+`MenuService`+`MenuBarComponent`; корневой `WorkbenchComponent` (этап 12). Швы → `EditorService`: `ActiveEditorStatusSource`, `DiagnosticsEditorSource`, `MarkerRevealTarget`, `GotoLineEditorSource`; шов → `WorkbenchComponent`: `WorkspaceFolderOpener` (Open Folder) |

### Профили

- **`createProductionContainer(ctx)`** — собирает полный production-контейнер
  с реальными tokenization/language. Используется в `main.ts`.
- **`createTestContainer()`** — возвращает `{ container, bindApp }`. Использует
  `darkPlusTheme`, `NULL_TOKEN_STYLE_RESOLVER`, `NULL_LANGUAGE_SERVICE` и пустой
  `TokenizationRegistry`. `bindApp(testApp.app)` вызывается после создания
  `TestApp` от view, чтобы поздно забиндить `TuiApplicationDIToken`.

Шаблон тестовой обёртки:

```typescript
const { container, bindApp } = createTestContainer();
const workbench = container.get(WorkbenchComponentDIToken);
workbench.mount();

const testApp = TestApp.create(workbench.view, size);
bindApp(testApp.app);
```

### Когда добавлять новый модуль

- Появляется набор из 2+ связанных сервисов одного домена.
- Новая ось вариативности (например, `Filesystem` с реальной/мок-реализацией) —
  заводим модуль с `Ctx` и подставляем разные значения в профилях.

Не нужно делать модуль для одиночного сервиса без вариативности — достаточно
`.bind()` в профиле.

