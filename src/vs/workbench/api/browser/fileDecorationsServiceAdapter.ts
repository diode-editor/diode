import type { IFileDecorationsService } from "../common/iFileDecorationsService.ts";

/** `ExplorerService` matches structurally: the Extensions layer does not pull in a Workbench service. */
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
