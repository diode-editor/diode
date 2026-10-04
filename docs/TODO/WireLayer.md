# Wire-слой языковых запросов extension host'а (G5)

Статус: `[~]` в работе — сделаны A, B, C1.

Языковые запросы хоста к субпроцессу (`languages.provide*`, rename, code
actions) описаны на проводе несколько раз: параметры — копиями в `wireTypes.ts`
и в `languagesNamespace.ts` (копии разъехались: `IWireCompletionParams` хоста
не знал `triggerKind`, который он же шлёт), ответы — своими `Wire*`-формами с
`IWireRange` и ручным разбором `parseWire*` на хосте, хотя после G4 протокол
типизирован картой методов. Сериализаторы объектов расширения раскиданы по
неймспейсам субпроцесса, а host-only код (`request*`, `RequestFn`) живёт в
`api/common`.

Как в vscode: одна декларация DTO в `extHost.protocol.ts`, конвертеры в
`extHostTypeConverters.ts` — единственное место утиной проверки объектов
расширения; диапазон на проводе — core-форма.

## План

- [x] A. Одна декларация параметров: база `IWireDocumentParams` /
  `IWirePositionParams`, адресация `{handle}` / `{handles}` в `wireTypes.ts`;
  локальные копии в `languagesNamespace.ts` удалены, субпроцесс читает те же
  типы через `Received<T>`; у formatting/code actions `handle`/`languageId`/
  `version` обязательны; `IWireCompletionParams` получил `triggerKind`/
  `triggerCharacter`; хост собирает параметры позиции одним `positionParams`.
- [x] B. Типизированный ответ: `RequestFn` отдаёт результат по карте протокола,
  разборщики `parseWire*` языковых ответов (и will-save) на хосте удалены,
  13 `request*` — один `LanguageFeaturesCustomer.request(method, params, empty)`
  с гардами «спавна нет» / `isSynced` и исходом сбоя. Проверки, которые делал
  только хост (кламп `activeSignature`, конечность чисел в диапазонах и
  индексах, конечный `kind` completion/folding, пустые строки документации и
  uri, строковый `kind` code action, `command: null` completion), — в
  сериализаторах субпроцесса (`languagesNamespace.serializers.test.ts`).
  Ответ форматирования и правки-спутники resolve типизированы
  `IWireEditorEdit` (EOL-ветки `WireTextEdit` в них не бывает). Folding:
  floor/кламп/вырожденные остались в `wireToCoreFoldingRegions` — инвариант
  модели ядра, не проверка объекта расширения.
- [x] C1. Core-`IRange` на проводе для языковых запросов и ответов: ответы
  completion, inline, definition, hover, references в карте протокола —
  `ICore*` (wire-копии форм и пять `wireToCore*` удалены, хост отдаёт ответ
  ядру как есть); параметры formatting и code actions несут `range: IRange`.
  Субпроцесс собирает диапазон одним `serializeRange` (утиный, `Number.isFinite`,
  нормализует `start <= end`); плоский `serializeDefinitionRange` остался
  обёрткой над ним для правок (C2). Folding не тронут: floor/кламп — инвариант
  модели ядра, `IFoldingRegion` — не диапазон.
- [ ] C2. Core-`IRange` в остальном проводе: `WireTextEdit`, `IWireEditorEdit`,
  изменения документа, `WireMarker`, диапазоны `window`; один `parseRange`;
  `serializeDefinitionRange` и `wireToCoreTextEdits` уходят вместе с плоской
  формой правок.
- [ ] D1. `api/common/extHostTypeConverters.ts`: сериализаторы из
  `languagesNamespace.ts`, `windowNamespace.ts`, `workspaceNamespace.ts` и
  `serialize*` из `wireTypes.ts`; один `rangeFrom` (утиный, `Number.isFinite`,
  нормализует `start <= end`).
- [ ] D2. Host-only код из `api/common/wireTypes.ts` — в
  `services/extensions/node/` (`RequestFn`, `settle`, остаток `request*`,
  разбор декораций); при надобности — правило check-layers.
- [ ] E. (необязательно) `bindExtensionHostToEditorGroup` в `api/browser` —
  одна проводка для `extensionHostModule.ts` и `ExtensionTestHarness.ts`.

## Не делаем

Декларативную таблицу провайдеров с merge-политикой и генерацию кода;
`createProviderRegistry`/`invokeProviders` в субпроцессе (их место занял
`registerByHandle` G2); `Set` подписок и `updateSubscriptions` (сняты G2);
`wireLanguageSources` (проводка уже одна строка); `$mid`/`Dto<T>`-маршалинг
Uri; 1-based Monaco `IRange` (наш core 0-based); закрытие no-op провайдеров
(это фичи, docs/TODO/LSP.md).
