import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { beforeAll, describe, expect, it } from "vitest";

import { settle, waitUntil } from "../../../../../TestUtils/timing.ts";
import {
    buildTypescriptLspExtension,
    type ITypescriptLspFixture,
    openInTypescriptLsp,
} from "../../../../../TestUtils/typescriptLspFixture.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { DEFAULT_CODE_LENS_OPTIONS } from "../../../../editor/contrib/codelens/browser/codeLensController.ts";
import { parseGoToLocationsArguments } from "../../../contrib/gotoDefinition/browser/goToLocationsArguments.ts";

const SOURCE = `export function add(left: number, right: number) {
    return left + right;
}
export function unused() {}
add(1, 2);
add(3, 4);
`;

const REFERENCES_ON = { "typescript.referencesCodeLens.enabled": true };
const WAIT_MS = 60_000;

async function open(settings: Readonly<Record<string, unknown>> = {}): Promise<ITypescriptLspFixture> {
    const fixture = await openInTypescriptLsp("main.ts", SOURCE, settings);
    // The harness has no core configuration service to read `editor.codeLens` from.
    fixture.editor.setCodeLens(DEFAULT_CODE_LENS_OPTIONS);
    return fixture;
}

/** Left click on `title` where the frame shows it; the view takes the click in its own coordinates. */
function clickTitle({ editor, frame }: ITypescriptLspFixture, title: string): void {
    const rows = frame().split("\n");
    const screenY = rows.findIndex((row) => row.includes(title));
    if (screenY < 0) throw new Error(`"${title}" is not on the frame`);
    const screenX = rows[screenY].indexOf(title);
    const view = editor.component.view.getChild();
    const origin = view.globalPosition;
    view.dispatchEvent(
        new TUIMouseEvent("mousedown", {
            button: "left",
            screenX,
            screenY,
            localX: screenX - origin.x,
            localY: screenY - origin.y,
        }),
    );
}

describe("ExtensionHost — code lens from the stock typescript-language-server", () => {
    beforeAll(buildTypescriptLspExtension, 120_000);

    it("the click on `2 references` hands the host command the server's locations", { timeout: 180_000 }, async () => {
        const fixture = await open(REFERENCES_ON);
        const { harness, editor, frame } = fixture;
        const seen: ReturnType<typeof parseGoToLocationsArguments>[] = [];
        harness.commandRegistry.register(
            "editor.action.showReferences",
            (uri: unknown, position: unknown, locations: unknown) => {
                seen.push(parseGoToLocationsArguments(uri, position, locations));
            },
        );
        try {
            await waitUntil("the row", () => frame().includes("2 references"), WAIT_MS);
            clickTitle(fixture, "2 references");
            await waitUntil("the command ran", () => seen.length > 0);
            const uri = editor.uri.toString();
            expect(seen[0].uri.toString()).toBe(uri);
            expect(seen[0].position.line).toBe(0);
            expect(seen[0].locations).toEqual([
                { uri, range: createRange(4, 0, 4, 3) },
                { uri, range: createRange(5, 0, 5, 3) },
            ]);
        } finally {
            await harness.dispose();
        }
    });

    it("`0 references` is on the frame and its click opens nothing", { timeout: 180_000 }, async () => {
        const fixture = await open(REFERENCES_ON);
        const { harness, frame } = fixture;
        let opened = 0;
        harness.commandRegistry.register("editor.action.showReferences", () => {
            opened++;
        });
        try {
            await waitUntil(
                "both rows",
                () => frame().includes("0 references") && frame().includes("2 references"),
                WAIT_MS,
            );
            clickTitle(fixture, "0 references");
            await settle(300);
            expect(opened).toBe(0);
            // The same click on the neighbour does open: the one above was not lost on the way.
            clickTitle(fixture, "2 references");
            await waitUntil("the neighbour opened", () => opened === 1);
        } finally {
            await harness.dispose();
        }
    });

    it(
        "the defaults show nothing; a change on the fly brings the rows and takes them away",
        { timeout: 180_000 },
        async () => {
            const { harness, settings, frame } = await open();
            try {
                await waitUntil("the text", () => frame().includes("export function add"), WAIT_MS);
                // An empty answer is also what a loading project gives: the server has time to prove the defaults wrong.
                await settle(3_000);
                expect(frame()).not.toContain("references");

                await settings.updateValue("typescript.referencesCodeLens.enabled", true);
                await waitUntil("the row", () => frame().includes("2 references"), WAIT_MS);

                await settings.updateValue("typescript.referencesCodeLens.enabled", false);
                await waitUntil("no row", () => !frame().includes("references"), WAIT_MS);
            } finally {
                await harness.dispose();
            }
        },
    );

    it("implementations of an interface are counted by their own setting", { timeout: 180_000 }, async () => {
        const fixture = await openInTypescriptLsp(
            "main.ts",
            "export interface Shape {}\nexport class Circle implements Shape {}\nexport class Square implements Shape {}\n",
            { "typescript.implementationsCodeLens.enabled": true },
        );
        fixture.editor.setCodeLens(DEFAULT_CODE_LENS_OPTIONS);
        try {
            await waitUntil("the row", () => fixture.frame().includes("2 implementations"), WAIT_MS);
        } finally {
            await fixture.harness.dispose();
        }
    });
});
