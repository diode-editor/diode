import type { IWireUpdateWorkspaceFolders } from "./wireTypes.ts";

/**
 * Сток смены папок воркспейса от расширений (`workspace.updateWorkspaceFolders`):
 * потребитель (module) открывает итоговый набор, если он выполним, или говорит
 * человеку, почему нет. Проверки эталона уже пройдены в субпроцессе.
 */
export interface IWorkspaceFoldersSink {
    update(request: IWireUpdateWorkspaceFolders): void;
}
