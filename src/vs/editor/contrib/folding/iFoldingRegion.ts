/** startLine — the always-visible header; endLine is inclusive. */
export interface IFoldingRegion {
    startLine: number;
    endLine: number;
    isCollapsed: boolean;
}

export function createFoldingRegion(startLine: number, endLine: number, isCollapsed = false): IFoldingRegion {
    return { startLine, endLine, isCollapsed };
}
