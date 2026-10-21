import type { IFileDecorationsService } from "../common/iFileDecorationsService.ts";

/** `ExplorerService` соответствует структурно: слой Extensions не тянет Workbench-сервис. */
export interface IFileDecorationsTarget {
    setFileDecorations(entries: readonly { path: string; color?: number; badge?: string; propagate?: boolean }[]): void;
}

export class FileDecorationsServiceAdapter implements IFileDecorationsService {
    private readonly explorer: IFileDecorationsTarget;

    public constructor(explorer: IFileDecorationsTarget) {
        this.explorer = explorer;
    }

    public setFileDecorations(
        entries: readonly { path: string; color?: number; badge?: string; propagate?: boolean }[],
    ): void {
        this.explorer.setFileDecorations(entries);
    }
}
