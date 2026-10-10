import { describe, expect, it } from "vitest";

import { Container } from "../../../../platform/instantiation/common/diContainer.ts";

import {
    firstCompressedFolderAction,
    lastCompressedFolderAction,
    nextCompressedFolderAction,
    previousCompressedFolderAction,
} from "./compressedFolderActions.ts";
import { type ExplorerService, ExplorerServiceDIToken } from "./explorerService.ts";

describe("compressedFolderActions", () => {
    it.each([
        [previousCompressedFolderAction, "previous"],
        [nextCompressedFolderAction, "next"],
        [firstCompressedFolderAction, "first"],
        [lastCompressedFolderAction, "last"],
    ] as const)("%s двигает текущий сегмент строки под курсором", (action, target) => {
        const moves: string[] = [];
        const accessor = new Container();
        accessor.bind(
            ExplorerServiceDIToken,
            () =>
                ({
                    moveCompressedFocus: (to: string) => {
                        moves.push(to);
                    },
                }) as unknown as ExplorerService,
        );
        action.run(accessor);
        expect(moves).toEqual([target]);
    });
});
