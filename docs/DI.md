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

Нижняя граница: **пакеты `@tuidom/*` токенов не объявляют и `diContainer` не импортируют** — движок живёт в отдельном репозитории и физически не может тянуть DI-модель Diode.

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
export class StatusBarComponent extends ThemedComponent {
    static dependencies = [StatusBarServiceDIToken, ThemeServiceDIToken] as const;

    constructor(statusBar: StatusBarService, themeService: ThemeService) {
        super(themeService);
        // ...
    }
}
```

Без зависимостей — `static dependencies = [] as const;`.

## Регистрация в контейнере

Контейнер конфигурируется в точке входа (`main.ts`). Одна строка на сервис:

```typescript
import { Container } from "../vs/platform/instantiation/common/diContainer.ts";

const container = new Container()
    .bind(TuiApplicationDIToken, () => application) // фабрика для leaf-сервисов
    .bind(EditorServiceDIToken, EditorService)      // класс — deps из static dependencies
    .bind(WorkbenchComponentDIToken, WorkbenchComponent);

const workbench = container.get(WorkbenchComponentDIToken);
```

Два варианта `.bind()`:
- **Класс** — `bind(token, Class)` — контейнер читает `Class.dependencies` и резолвит автоматически
- **Фабрика** — `bind(token, () => value)` — произвольная логика создания

## Гарантии

- Компилятор при `bind(token, Class)` проверяет тип токена и соответствие
  `static dependencies` параметрам конструктора (количество, порядок, типы).
- Рантайм: отсутствие биндинга и циклическая зависимость — понятные ошибки.
- Все биндинги — lazy singletons.
- Классы остаются plain (`static dependencies` не влияет на конструктор) — в
  тестах экземпляры создаются напрямую, `new StatusBarComponent(fake, theme)`.

## Модули и профили

Чтобы избежать копипасты конфигурации в каждой точке входа (`main.ts`, тесты,
демо), биндинги группируются в **модули** — функции вида
`(container, ctx) => void`. Модули собираются в **профили** — фабрики готовых
контейнеров под конкретный сценарий (production, test).

Файлы: `src/vs/diode/modules/` (исключение — `terminalEnvironmentModule`, живёт рядом со своим сервисом в `src/vs/workbench/services/terminalEnvironment/node/`).

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

Актуальный список — файлы `src/vs/diode/modules/` (по модулю на домен: core,
commands, theme, tokenization, backend, configuration, state, logging, markers,
keybindings, workspace, fileWatcher, extensionHost, workbench). У части модулей
есть `*Default`-вариант с null-реализациями для тестов и demo. Крупнейший —
`workbenchModule`: все пары Service ↔ Component слоя Workbench и швы между ними;
состав смотреть в самом файле, а не здесь (список дрейфует).

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

