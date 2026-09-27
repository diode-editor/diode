# Долг по плановым мутационным отчётам (#271–#294)

Статус: `[ ]` открыта. Заведено при уборке GitHub issues 2026-09-27: пять
тикетов-отчётов закрыты, их находки сведены сюда.

## Откуда взялось

`mutation.yml` раз в три дня мутирует окно `mutation-baseline..main` и заводит
issue с выжившими. С 25 августа по 10 сентября прогон завёл пять таких тикетов;
ни один не разбирался как задача — база окна двигалась дальше, и повторно эти
строки в скоуп уже не попадают (скоуп считается по диффу окна). То есть список
ниже — единственное место, где этот долг записан.

С 13 сентября прогон **молча не работал**: `git diff -U0` окна перерос 1 МиБ —
дефолтный `maxBuffer` у `spawnSync`, — скрипт падал ENOBUFS с пустым stderr, а
воркфлоу читал это как «в окне нечего мутировать» и оставался зелёным, не двигая
базу. Починено (maxBuffer + красный статус при падении без отчёта); окно
`53df87f4..main` на момент починки — 71 коммит и 1255 записей скоупа, в том
числе линт-прогон #333 (598 файлов, см.
[MutationDebtAfterLintSweep](MutationDebtAfterLintSweep.md)). Догонять его надо
частями через `workflow_dispatch` с промежуточной `base`, как описано в
комментарии к шагу «Сдвинуть базу» в `mutation.yml`.

## Что осталось по отчётам

Числа — выжившие на момент отчёта. Часть с тех пор закрыта попутно (в файле
появились `Stryker disable` или тесты — колонка «сдвиг»), но перепроверки
прогоном не было: статус каждого мутанта неизвестен, пока файл не прогнан
`node scripts/mutation-diff.mjs <base>` с базой ДО его коммита или узким
`--mutate` по файлу.

| Отчёт | Окно | Балл | Файл | Выжило | Сдвиг с тех пор |
|---|---|--:|---|--:|---|
| [#271](https://github.com/diode-editor/diode/issues/271) | `11c605ee..275185bb` | 83.77 | `workbench/browser/parts/quickinput/quickPickElement.ts` | 76 | 2 коммита, disable 0→3 |
| | | | `workbench/browser/parts/quickinput/quickPickRows.ts` | 36 | — |
| | | | `workbench/browser/parts/quickinput/quickPickFrameElement.ts` | 25 | — |
| | | | `workbench/browser/actions/multiCursorActions.ts` | 23 | — |
| | | | `editor/contrib/multicursor/multiCursorCommands.ts` | 5 | — |
| | | | `workbench/contrib/scm/browser/graphViewComponent.ts` | 5 | строки 99–105 и в MutationDebtAfterLintSweep |
| | | | `editor/common/viewModel/editorViewState.ts` | 4 | — |
| | | | `editor/contrib/multicursor/multiCursorSession.ts` | 3 | — |
| | | | `workbench/browser/parts/views/paneHeaderElement.ts` | 3 | — |
| | | | `workbench/browser/workbenchContextKeys.ts` | 3 | в #333 добит `filesExplorerFocus` |
| | | | `editor/common/core/iRange.ts` | 2 | — |
| | | | `editor/common/core/sortAndMergeSelections.ts` | 1 | — |
| | | | `workbench/contrib/scm/browser/graphService.ts` | 1 | — |
| [#280](https://github.com/diode-editor/diode/issues/280) | `275185bb..5e10d9d8` | 98.26 | `workbench/common/configuration/editorConfiguration.ts` | 4 | 6 коммитов |
| | | | `platform/progress/common/progressService.ts` | 3 | — |
| | | | `workbench/contrib/scm/browser/gitOpClient.ts` | 2 | — |
| | | | `editor/common/model/indentationDetector.ts` | 1 | — (та же строка в MutationDebtAfterLintSweep) |
| [#283](https://github.com/diode-editor/diode/issues/283) | `5e10d9d8..b7aaa225` | 99.79 | `editor/browser/textViewRendering.ts:172` (`screenX++`, не покрыт) | 1 | 4 коммита, disable 4→11 |
| [#292](https://github.com/diode-editor/diode/issues/292) | `5f3d1743..31337f5c` | 98.08 | `workbench/contrib/extensions/browser/extensionsActions.ts` | 5 | — |
| | | | `workbench/contrib/extensions/browser/extensionsComponent.ts` | 5 | 3 коммита |
| | | | `workbench/api/common/wireTypes.ts` | 2 | 12 коммитов, disable 2→25 |
| | | | `workbench/contrib/extensions/browser/extensionRows.ts` | 2 | — |
| | | | `platform/extensionManagement/node/httpRegistrySource.ts` | 1 | — |
| | | | `workbench/api/common/languagesNamespace.ts` | 1 | 12 коммитов, disable 1→17 |
| | | | `workbench/contrib/hover/browser/hoverActions.ts` | 1 | — |
| | | | `diode/modules/extensionsModule.ts` | 1 | — |
| | | | `workbench/contrib/extensions/browser/extensionPageContent.ts` | 1 | — |
| | | | `workbench/contrib/extensions/common/extensionsWorkbench.ts` | 1 | — |
| [#294](https://github.com/diode-editor/diode/issues/294) | `31337f5c..53df87f4` | 95.48 | `workbench/contrib/references/browser/referencesActions.ts` | 19 | — |
| | | | `workbench/contrib/references/browser/referencesComponent.ts` | 4 | disable 3→4 |
| | | | `workbench/contrib/extensions/browser/extensionPageHeaderElement.ts` | 3 | — |
| | | | `workbench/contrib/extensions/browser/extensionPageActions.ts` | 2 | — |
| | | | `diode/modules/productionProfile.ts` | 1 | 4 коммита |
| | | | `workbench/api/common/wireTypes.ts` | 1 | см. выше |
| | | | `workbench/contrib/references/browser/referencesService.ts` | 1 | — |
| | | | `base/node/restartProcess.ts` | 1 | — |
| | | | `workbench/contrib/extensions/browser/extensionPageElement.ts` | 1 | — |
| | | | `workbench/contrib/extensions/browser/extensionRows.ts` | 1 | — |
| | | | `workbench/services/lifecycle/common/windowReload.ts` | 1 | — |

Итого 253 выживших в 37 файлах; 137 из них — квик-пик (`quickPickElement.ts`,
`quickPickRows.ts`, `quickPickFrameElement.ts`), ещё 31 — мультикурсор. Диффы
мутантов — в телах закрытых тикетов по ссылкам; в #271 расписаны 40 из 187,
остальные были только в HTML-артефакте прогона, а артефакты живут 30 дней —
для #271, #280 и #283 они уже истекли. Восстановить полный список можно только
узким прогоном по файлу.

## Что в этом списке типично

- **Иконки-литералы и заголовки команд** (`""` → `""`, `title: "View: Show Extensions"` → `""`)
  — почти все выжившие `referencesActions.ts` и `extensionsActions.ts`. Тест, который дошёл бы
  до кадра с кнопкой или до палитры команд, убивает их пачкой; иначе — честный
  `Stryker disable` на StringLiteral с причиной «строка UI, проверяется e2e».
- **Схемы настроек** (`editorConfiguration.ts`: `type`, `default`, `description`) — то же самое,
  один тест на регистрацию схемы закрывает все четыре.
- **Дефолты полей** (`placeholder`, `acceptMode`, `rowsWidth = -1` в `quickPickElement.ts`) —
  тут дырка настоящая: 76 мутантов в одном файле означает, что квик-пик тестируется через
  фасад, а не через кадр.

## Как закрывать

По конвенции AGENTS.md: тестом на наблюдаемый результат, либо `// Stryker disable
next-line <мутатор>: причина`. Перед починкой «выжившего» — подменить руками и
прогнать тесты файла ([MutationGateFlake](MutationGateFlake.md): часть выживших
в отчётах — фантомы гейта). Признак «закрыто» по файлу — узкий прогон
`npx stryker run --mutate <файл>` без выживших.
