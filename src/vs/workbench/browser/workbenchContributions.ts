import type { IWorkbenchContributionRegistration } from "../common/iWorkbenchContribution.ts";
import { DiffSnapshotRefreshContributionDIToken } from "../contrib/diff/browser/diffSnapshotRefreshContribution.ts";
import { AutoRevealContributionDIToken } from "../contrib/files/browser/autoRevealContribution.ts";
import { OpenFileCommandContributionDIToken } from "../contrib/files/browser/openFileCommandContribution.ts";
import { OutputChannelActionsDIToken } from "../contrib/output/browser/outputChannelActions.ts";
import { QuickDiffServiceDIToken } from "../contrib/scm/browser/quickDiffService.ts";
import { ScmBusyContextContributionDIToken } from "../contrib/scm/browser/scmBusyContextContribution.ts";
import { ScmStatusBarContributionDIToken } from "../contrib/scm/browser/scmStatusBarContribution.ts";
import { ThemeConfigContributionDIToken } from "../contrib/themes/browser/themeConfigContribution.ts";
import { HistoryServiceDIToken } from "../services/history/browser/historyService.ts";
import { TerminalEnvContextKeysContributionDIToken } from "../services/terminalEnvironment/node/terminalEnvContextKeysContribution.ts";
import { TerminalEnvStatusContributionDIToken } from "../services/terminalEnvironment/node/terminalEnvStatusContribution.ts";

import { OpenFailureNotificationContributionDIToken } from "./openFailureNotificationContribution.ts";
import { EditorStatusContributionDIToken } from "./parts/editor/editorStatusContribution.ts";
import { PanelFocusContributionDIToken } from "./parts/panel/panelFocusContribution.ts";
import { ProgressStatusBarContributionDIToken } from "./parts/statusbar/progressStatusBarContribution.ts";
import { ViewProgressContributionDIToken } from "./parts/views/viewProgressContribution.ts";
import { ViewTitleActionsContributionDIToken } from "./parts/views/viewTitleActionsContribution.ts";
import { SetContextCommandContributionDIToken } from "./setContextCommandContribution.ts";

/**
 * Явный список workbench-contributions (зеркало `builtinActions`, без
 * import-side-effect самрегистрации). Порядок внутри фазы = порядок
 * инстанцирования. Новую фич-проводку добавляем сюда, а не строкой в конструктор
 * `WorkbenchComponent`.
 */
export const WORKBENCH_CONTRIBUTIONS: readonly IWorkbenchContributionRegistration[] = [
    { token: EditorStatusContributionDIToken, phase: "ready" },
    { token: TerminalEnvStatusContributionDIToken, phase: "ready" },
    // when-ключи окружения (tier/os/cap_*/mode_*/macKeys): до первого нажатия.
    { token: TerminalEnvContextKeysContributionDIToken, phase: "ready" },
    { token: AutoRevealContributionDIToken, phase: "ready" },
    { token: ThemeConfigContributionDIToken, phase: "ready" },
    { token: OpenFileCommandContributionDIToken, phase: "ready" },
    // Встроенная `setContext`: расширение может дёрнуть её в activate(), то есть
    // раньше любого пользовательского действия.
    // Stryker disable next-line ObjectLiteral,StringLiteral: снятие записи ненаблюдаемо юнитом; без неё команды нет, и это ловит e2e-сценарий extension-storage (клавиша расширения не оживает после Arm)
    { token: SetContextCommandContributionDIToken, phase: "ready" },
    { token: PanelFocusContributionDIToken, phase: "ready" },
    // Сообщение «ресурс открыть нечем»: подписка должна стоять до первого
    // открытия, иначе первая же неудача пройдёт молча.
    // Stryker disable next-line ObjectLiteral,StringLiteral: снятие записи ненаблюдаемо юнитом; без неё тост не появляется, и это ловит e2e-сценарий virtualDocument
    { token: OpenFailureNotificationContributionDIToken, phase: "ready" },
    // Спиннеры занятости в заголовках секций: подписка должна стоять до первой
    // операции, иначе её начало пройдёт мимо.
    // Stryker disable next-line ObjectLiteral,StringLiteral: см. HistoryService ниже — снятие записи ненаблюдаемо юнитом, проводку проверяет поднятие приложения
    { token: ViewProgressContributionDIToken, phase: "ready" },
    // Долгие сетевые операции видно и когда Source Control не показан.
    // Stryker disable next-line ObjectLiteral,StringLiteral: см. HistoryService ниже — снятие записи ненаблюдаемо юнитом, проводку проверяет поднятие приложения
    { token: ProgressStatusBarContributionDIToken, phase: "ready" },
    // Живой тулбар: кнопки заголовков реагируют на смену контекст-ключей.
    // Stryker disable next-line ObjectLiteral,StringLiteral: см. HistoryService ниже — снятие записи ненаблюдаемо юнитом, проводку проверяет поднятие приложения
    { token: ViewTitleActionsContributionDIToken, phase: "ready" },
    // История навигации: подписки должны стоять до открытия первого файла.
    // Убрать эту строку сейчас ничего не ломает — сервис всё равно поднимается
    // раньше, когда workbenchContextKeys читает canGoBack/canGoForward. Но такая
    // гарантия порядка держится на чужой детали, поэтому запись оставляем явной.
    // Stryker disable next-line ObjectLiteral,StringLiteral: см. выше — снятие записи ненаблюдаемо
    { token: HistoryServiceDIToken, phase: "ready" },
    // Каналы Output как команды + пункты submenu селектора.
    { token: OutputChannelActionsDIToken, phase: "ready" },
    // Живые change-bars: считать дифф можно только после того, как есть редакторы.
    { token: QuickDiffServiceDIToken, phase: "ready" },
    // Автоосвежение снимочных сторон дифф-вкладок по onDidChangeFile (US-31).
    { token: DiffSnapshotRefreshContributionDIToken, phase: "ready" },
    // Ветка + sync-счётчики в статус-баре (из repo-state git-расширения).
    { token: ScmStatusBarContributionDIToken, phase: "ready" },
    // Ключ занятости git: на нём висит enablement мутирующих команд.
    // Stryker disable next-line ObjectLiteral,StringLiteral: см. HistoryService ниже — снятие записи ненаблюдаемо юнитом, проводку проверяет поднятие приложения
    { token: ScmBusyContextContributionDIToken, phase: "ready" },
];
