/** 0-based. */
export interface IPosition {
    readonly line: number;
    readonly character: number;
}

export function createPosition(line: number, character: number): IPosition {
    return { line, character };
}

export function comparePositions(a: IPosition, b: IPosition): number {
    if (a.line !== b.line) {
        return a.line - b.line;
    }
    return a.character - b.character;
}

export function positionsEqual(a: IPosition, b: IPosition): boolean {
    return a.line === b.line && a.character === b.character;
}

export interface IPositionClampTarget {
    readonly lineCount: number;
    getLineLength(line: number): number;
}

/**
 * Аналог `validatePosition` в vscode — дверь для позиций из внешнего источника:
 * позиция за концом строки роняет редактор целиком (highlight вхождений
 * зовётся из render).
 */
export function clampPositionToDocument(doc: IPositionClampTarget, position: IPosition): IPosition {
    const line = Math.min(Math.max(position.line, 0), doc.lineCount - 1);
    const character = Math.min(Math.max(position.character, 0), doc.getLineLength(line));
    return { line, character };
}
