import { packRgb } from "@tuidom/core/common/colorUtils";
import { Size } from "@tuidom/core/common/geometryPromitives";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { bench, describe } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { ITextMatch } from "../../../services/search/common/textSearch.ts";

import { buildFileRow, buildMatchRow, type ISearchRowStyles } from "./searchResultRows.ts";

// Repro of cursor slowness in the search results tree (`npm run test:perf`). An iteration is ArrowDown +
// ArrowUp through the real input parser (4 frames); the fixtures separate the cost of line length and row count.
// Fixtures live at module top level: in `vitest bench` a heavy beforeAll gathers no samples.

const STYLES: ISearchRowStyles = {
    dimFg: packRgb(128, 128, 128),
    matchFg: packRgb(0, 0, 0),
    matchBg: packRgb(234, 92, 0),
};

function makeSearchApp(rowCount: number, afterLength: number): TestApp {
    const list = new ListViewElement({ typeahead: false });
    const after = " = 42;" + "x".repeat(afterLength);
    let added = 0;
    for (let f = 0; added < rowCount; f++) {
        const fileId = `f${f}`;
        list.appendRow(buildFileRow(fileId, `src/dir${f}/file${f}.ts`, 9, STYLES));
        for (let m = 0; m < 9 && added < rowCount; m++, added++) {
            const match: ITextMatch = {
                lineNumber: 100 + m,
                startColumn: 6,
                endColumn: 12,
                preview: { before: "const ", inside: "needle", after },
            };
            list.appendRow(buildMatchRow(`m${added}`, match, STYLES), { parentId: fileId });
        }
    }
    const app = TestApp.createWithContent(list, new Size(45, 35));
    // Measure the engine, not the harness: assertValidTree (a DFS after every frame, off in production) gave
    // ~9 ms/frame on the 10k fixture and buried the measured cost.
    app.app.validateTreeAfterRender = false;
    list.focus();
    app.render();
    return app;
}

const shortRows = makeSearchApp(200, 0);
const longRows = makeSearchApp(200, 10_000);
const manyRows = makeSearchApp(10_000, 0);

describe("Search — cursor over the result tree (4 frames per iteration)", () => {
    bench("200 lines, short after: baseline cost", () => {
        shortRows.sendKey("ArrowDown");
        shortRows.sendKey("ArrowUp");
    });

    bench("200 lines, 10k-char after: cost of re-segmenting visible rows", () => {
        longRows.sendKey("ArrowDown");
        longRows.sendKey("ArrowUp");
    });

    bench("10k lines, short after: cost of the O(N) style pass", () => {
        manyRows.sendKey("ArrowDown");
        manyRows.sendKey("ArrowUp");
    });
});
