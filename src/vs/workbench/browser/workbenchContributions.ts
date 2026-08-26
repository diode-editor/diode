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
import { TerminalEnvStatusContributionDIToken } from "../services/terminalEnvironment/node/terminalEnvStatusContribution.ts";

import { EditorStatusContributionDIToken } from "./parts/editor/editorStatusContribution.ts";
import { ProgressStatusBarContributionDIToken } from "./parts/statusbar/progressStatusBarContribution.ts";
import { PanelFocusContributionDIToken } from "./parts/panel/panelFocusContribution.ts";
import { ViewProgressContributionDIToken } from "./parts/views/viewProgressContribution.ts";
import { ViewTitleActionsContributionDIToken } from "./parts/views/viewTitleActionsContribution.ts";

/**
 * Явный список workbench-contributions (зеркало `builtinActions`, без
 * import-side-effect самрегистрации). Порядок внутри фазы = порядок
 * инстанцирования. Новую фич-проводку добавляем сюда, а не строкой в конструктор
 * `WorkbenchComponent`.
 */
export const WORKBENCH_CONTRIBUTIONS: readonly IWorkbenchContributionRegistration[] = [
    { token: EditorStatusContributionDIToken, phase: "restored" },
    { token: TerminalEnvStatusContributionDIToken, phase: "restored" },
    { token: AutoRevealContributionDIToken, phase: "restored" },
    { token: ThemeConfigContributionDIToken, phase: "restored" },
    { token: OpenFileCommandContributionDIToken, phase: "restored" },
    { token: PanelFocusContributionDIToken, phase: "restored" },
    // Спиннеры занятости в заголовках секций: подписка должна стоять до первой
    // операции, иначе её начало пройдёт мимо.
    // Stryker disable next-line ObjectLiteral,StringLiteral: см. HistoryService ниже — снятие записи ненаблюдаемо юнитом, проводку проверяет поднятие приложения
    { token: ViewProgressContributionDIToken, phase: "restored" },
    // Долгие сетевые операции видно и когда Source Control не показан.
    // Stryker disable next-line ObjectLiteral,StringLiteral: см. HistoryService ниже — снятие записи ненаблюдаемо юнитом, проводку проверяет поднятие приложения
    { token: ProgressStatusBarContributionDIToken, phase: "restored" },
    // Живой тулбар: кнопки заголовков реагируют на смену контекст-ключей.
    // Stryker disable next-line ObjectLiteral,StringLiteral: см. HistoryService ниже — снятие записи ненаблюдаемо юнитом, проводку проверяет поднятие приложения
    { token: ViewTitleActionsContributionDIToken, phase: "restored" },
    // История навигации: подписки должны стоять до открытия первого файла.
    // Убрать эту строку сейчас ничего не ломает — сервис всё равно поднимается
    // раньше, когда workbenchContextKeys читает canGoBack/canGoForward. Но такая
    // гарантия порядка держится на чужой детали, поэтому запись оставляем явной.
    // Stryker disable next-line ObjectLiteral,StringLiteral: см. выше — снятие записи ненаблюдаемо
    { token: HistoryServiceDIToken, phase: "restored" },
    // Каналы Output как команды + пункты submenu селектора.
    { token: OutputChannelActionsDIToken, phase: "restored" },
    // Живые change-bars: считать дифф можно только после того, как есть редакторы.
    { token: QuickDiffServiceDIToken, phase: "restored" },
    // Автоосвежение снимочных сторон дифф-вкладок по onDidChangeFile (US-31).
    { token: DiffSnapshotRefreshContributionDIToken, phase: "restored" },
    // Ветка + sync-счётчики в статус-баре (из repo-state git-расширения).
    { token: ScmStatusBarContributionDIToken, phase: "restored" },
    // Ключ занятости git: на нём висит enablement мутирующих команд.
    // Stryker disable next-line ObjectLiteral,StringLiteral: см. HistoryService ниже — снятие записи ненаблюдаемо юнитом, проводку проверяет поднятие приложения
    { token: ScmBusyContextContributionDIToken, phase: "restored" },
];
