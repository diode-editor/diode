import type { IWireUpdateWorkspaceFolders } from "./wireTypes.ts";

/** Проверки эталона уже пройдены в субпроцессе; невыполнимый набор потребитель объясняет человеку. */
export interface IWorkspaceFoldersSink {
    update(request: IWireUpdateWorkspaceFolders): void;
}
