import { describe, expect, it } from "vitest";

import { Container } from "../../../../platform/instantiation/common/diContainer.ts";

import { openEditorsCloseEditorAction } from "./openEditorsActions.ts";
import { type OpenEditorsElement, type OpenEditorsView, OpenEditorsViewDIToken } from "./openEditorsView.ts";

describe("openEditors.closeEditor", () => {
    function closedBy(focused: OpenEditorsElement | null): OpenEditorsElement[] {
        const closed: OpenEditorsElement[] = [];
        const accessor = new Container();
        accessor.bind(
            OpenEditorsViewDIToken,
            () =>
                ({
                    getFocusedElement: () => focused,
                    closeEditor: (element: OpenEditorsElement) => {
                        closed.push(element);
                    },
                }) as unknown as OpenEditorsView,
        );
        openEditorsCloseEditorAction.run(accessor);
        return closed;
    }

    it("closes the editor under the cursor", () => {
        const editor = { kind: "editor" } as OpenEditorsElement;
        expect(closedBy(editor)).toEqual([editor]);
    });

    it("a group row closes nothing", () => {
        expect(closedBy({ kind: "group" } as OpenEditorsElement)).toEqual([]);
    });

    it("an empty list has nothing under the cursor", () => {
        expect(closedBy(null)).toEqual([]);
    });
});
