import { afterEach, describe, expect, it, vi } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { WorkspaceContextService } from "../../../../platform/workspace/common/workspaceContextService.ts";

import { SnippetParser, type VariableResolver } from "./snippetParser.ts";
import {
    ClipboardBasedVariableResolver,
    CommentBasedVariableResolver,
    CompositeSnippetVariableResolver,
    ModelBasedVariableResolver,
    RandomBasedVariableResolver,
    TimeBasedVariableResolver,
    WorkspaceBasedVariableResolver,
} from "./snippetVariables.ts";

/** The template with its variables resolved, as an insert gives it. */
function resolve(resolver: VariableResolver, template: string): string {
    return new SnippetParser().parse(template).resolveVariables(resolver).toString();
}

const file = (filePath: string): ModelBasedVariableResolver =>
    new ModelBasedVariableResolver(Uri.file(filePath), undefined);

function folderWorkspace(folder: string): WorkspaceContextService {
    const workspace = new WorkspaceContextService();
    workspace.setWorkspaceFolder(folder);
    return workspace;
}

describe("ModelBasedVariableResolver (upstream `editor variables, file/dir`)", () => {
    it("the file name, its directory and its path", () => {
        expect(resolve(file("/foo/files/text.txt"), "$TM_FILENAME|$TM_DIRECTORY|$TM_DIRECTORY_BASE|$TM_FILEPATH")).toBe(
            "text.txt|/foo/files|files|/foo/files/text.txt",
        );
    });

    it("TM_FILENAME_BASE drops the last extension only, and keeps a leading dot (#32737)", () => {
        expect(resolve(file("/foo/text.txt"), "$TM_FILENAME_BASE")).toBe("text");
        expect(resolve(file("/foo/a.b.c"), "$TM_FILENAME_BASE")).toBe("a.b");
        expect(resolve(file("/foo/.git"), "$TM_FILENAME_BASE")).toBe(".git");
        expect(resolve(file("/foo/foo."), "$TM_FILENAME_BASE")).toBe("foo");
        expect(resolve(file("/foo/ghi"), "$TM_FILENAME_BASE")).toBe("ghi");
    });

    it("a resource without a directory, as an untitled document: no directory, the path is its name", () => {
        const untitled = new ModelBasedVariableResolver(Uri.parse("untitled:Untitled-1"), undefined);
        expect(resolve(untitled, "$TM_FILENAME|$TM_FILENAME_BASE|$TM_DIRECTORY|$TM_DIRECTORY_BASE|$TM_FILEPATH")).toBe(
            "Untitled-1|Untitled-1|||Untitled-1",
        );
    });

    it("RELATIVE_FILEPATH is relative to the workspace folder, the full path outside it (#114208)", () => {
        const workspace = folderWorkspace("/foo");
        expect(
            resolve(new ModelBasedVariableResolver(Uri.file("/foo/files/text.txt"), workspace), "$RELATIVE_FILEPATH"),
        ).toBe("files/text.txt");
        expect(
            resolve(new ModelBasedVariableResolver(Uri.file("/bar/text.txt"), workspace), "$RELATIVE_FILEPATH"),
        ).toBe("/bar/text.txt");
        expect(resolve(file("/bar/text.txt"), "$RELATIVE_FILEPATH")).toBe("/bar/text.txt");
        expect(resolve(new ModelBasedVariableResolver(Uri.file("/foo/a.ts"), workspace), "$TM_FILEPATH")).toBe(
            "/foo/a.ts",
        );
    });

    it("transforms apply to the value; other variables are not its", () => {
        expect(resolve(file("/foo/main.ts"), "${TM_FILENAME/(.*)\\..+$/$1/}")).toBe("main");
        expect(
            resolve(
                file("/foo/CapitalCase"),
                "${TM_FILENAME_BASE/([A-Z][a-z]+)([A-Z][a-z]+$)?/${1:/downcase}-${2:/downcase}/g}",
            ),
        ).toBe("capital-case");
        expect(resolve(file("/foo/a"), "${CLIPBOARD:none}")).toBe("none");
    });
});

describe("ClipboardBasedVariableResolver", () => {
    it("the whole text for one edit; nothing for an empty clipboard", () => {
        expect(resolve(new ClipboardBasedVariableResolver("a\nb", 0, 1), "$CLIPBOARD")).toBe("a\nb");
        expect(resolve(new ClipboardBasedVariableResolver("", 0, 1), "<${CLIPBOARD:x}>")).toBe("<x>");
        expect(resolve(new ClipboardBasedVariableResolver(undefined, 0, 1), "<$CLIPBOARD>")).toBe("<>");
    });

    it("a non-blank line per edit spreads: each edit gets its own line", () => {
        expect(resolve(new ClipboardBasedVariableResolver("one\r\n \ntwo", 1, 2), "$CLIPBOARD")).toBe("two");
        expect(resolve(new ClipboardBasedVariableResolver("one\rtwo", 0, 2), "$CLIPBOARD")).toBe("one");
        expect(resolve(new ClipboardBasedVariableResolver("one\ntwo\nthree", 1, 2), "$CLIPBOARD")).toBe(
            "one\ntwo\nthree",
        );
    });

    it("resolves CLIPBOARD only", () => {
        expect(resolve(new ClipboardBasedVariableResolver("abc", 0, 1), "${SELECTION:x}")).toBe("x");
    });
});

describe("CommentBasedVariableResolver", () => {
    it("the language's tokens", () => {
        const resolver = new CommentBasedVariableResolver({ lineComment: "//", blockComment: ["/*", "*/"] });
        expect(resolve(resolver, "$LINE_COMMENT $BLOCK_COMMENT_START $BLOCK_COMMENT_END ${CLIPBOARD:x}")).toBe(
            "// /* */ x",
        );
    });

    it("a token the language lacks, or a language without comments, falls to the default", () => {
        const lineOnly = new CommentBasedVariableResolver({ lineComment: "#" });
        expect(resolve(lineOnly, "$LINE_COMMENT|${BLOCK_COMMENT_START:a}|${BLOCK_COMMENT_END:b}")).toBe("#|a|b");
        expect(
            resolve(
                new CommentBasedVariableResolver(undefined),
                "<${LINE_COMMENT:x}|${BLOCK_COMMENT_START:y}|${BLOCK_COMMENT_END:z}>",
            ),
        ).toBe("<x|y|z>");
    });
});

describe("TimeBasedVariableResolver", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    const at = (date: Date): TimeBasedVariableResolver => {
        vi.useFakeTimers({ now: date });
        return new TimeBasedVariableResolver();
    };

    it("two digits for the month, the day and the time, three for the milliseconds", () => {
        const resolver = at(new Date(2026, 1, 3, 4, 5, 6, 7));
        expect(
            resolve(
                resolver,
                "$CURRENT_YEAR $CURRENT_YEAR_SHORT-$CURRENT_MONTH-$CURRENT_DATE $CURRENT_HOUR:$CURRENT_MINUTE:$CURRENT_SECOND.$CURRENT_MILLISECOND",
            ),
        ).toBe("2026 26-02-03 04:05:06.007");
        const farFuture = new Date(2026, 0, 1);
        farFuture.setFullYear(12345);
        expect(resolve(at(farFuture), "$CURRENT_YEAR_SHORT")).toBe("45");
    });

    it("English day and month names, full and short", () => {
        const days: string[] = [];
        for (let day = 1; day <= 7; day++) {
            days.push(resolve(at(new Date(2026, 1, day)), "$CURRENT_DAY_NAME/$CURRENT_DAY_NAME_SHORT"));
        }
        expect(days).toEqual([
            "Sunday/Sun",
            "Monday/Mon",
            "Tuesday/Tue",
            "Wednesday/Wed",
            "Thursday/Thu",
            "Friday/Fri",
            "Saturday/Sat",
        ]);
        const months: string[] = [];
        for (let month = 0; month < 12; month++) {
            months.push(resolve(at(new Date(2026, month, 1)), "$CURRENT_MONTH_NAME/$CURRENT_MONTH_NAME_SHORT"));
        }
        expect(months).toEqual([
            "January/Jan",
            "February/Feb",
            "March/Mar",
            "April/Apr",
            "May/May",
            "June/Jun",
            "July/Jul",
            "August/Aug",
            "September/Sep",
            "October/Oct",
            "November/Nov",
            "December/Dec",
        ]);
    });

    it("unix time in seconds and milliseconds, of one moment for the whole resolver", () => {
        const resolver = at(new Date(1_700_000_000_999));
        vi.advanceTimersByTime(5000);
        expect(resolve(resolver, "$CURRENT_SECONDS_UNIX $CURRENT_MILLISECONDS_UNIX")).toBe("1700000000 1700000000999");
    });

    it("the time zone: its offset as ±HH:MM, west of Greenwich negative, and its IANA name", () => {
        const resolver = at(new Date(2026, 0, 1));
        const offsets = vi.spyOn(Date.prototype, "getTimezoneOffset");
        offsets.mockReturnValueOnce(-180);
        expect(resolve(resolver, "$CURRENT_TIMEZONE_OFFSET")).toBe("+03:00");
        offsets.mockReturnValueOnce(570);
        expect(resolve(resolver, "$CURRENT_TIMEZONE_OFFSET")).toBe("-09:30");
        offsets.mockReturnValueOnce(0);
        expect(resolve(resolver, "$CURRENT_TIMEZONE_OFFSET")).toBe("+00:00");
        offsets.mockRestore();
        expect(resolve(resolver, "$CURRENT_TIMEZONE_NAME")).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    });
});

describe("WorkspaceBasedVariableResolver", () => {
    it("a folder: its name and path", () => {
        expect(
            resolve(
                new WorkspaceBasedVariableResolver(folderWorkspace("/work/proj")),
                "$WORKSPACE_NAME|$WORKSPACE_FOLDER",
            ),
        ).toBe("proj|/work/proj");
    });

    it("a workspace file: its name without the extension and its directory", () => {
        const workspace = new WorkspaceContextService();
        workspace.setWorkspaceFile("/work/conf/team.code-workspace", { folder: "/work/proj", folderName: "p" });
        expect(resolve(new WorkspaceBasedVariableResolver(workspace), "$WORKSPACE_NAME|$WORKSPACE_FOLDER")).toBe(
            "team|/work/conf",
        );
    });

    it("no folder: the default or nothing", () => {
        const empty = new WorkspaceBasedVariableResolver(new WorkspaceContextService());
        expect(resolve(empty, "<${WORKSPACE_NAME:none}|$WORKSPACE_FOLDER>")).toBe("<none|>");
        expect(resolve(new WorkspaceBasedVariableResolver(undefined), "<$WORKSPACE_NAME>")).toBe("<>");
    });

    it("resolves only its own variables", () => {
        expect(resolve(new WorkspaceBasedVariableResolver(folderWorkspace("/w")), "${TM_FILENAME:x}")).toBe("x");
    });
});

describe("RandomBasedVariableResolver", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("RANDOM is six decimal digits and RANDOM_HEX six hex ones, zero-padded", () => {
        vi.spyOn(Math, "random").mockReturnValue(0.000042);
        expect(resolve(new RandomBasedVariableResolver(), "$RANDOM $RANDOM_HEX")).toBe("000042 0002c0");
        vi.spyOn(Math, "random").mockReturnValue(0.9999999);
        expect(resolve(new RandomBasedVariableResolver(), "$RANDOM $RANDOM_HEX")).toBe("999999 fffffe");
    });

    it("UUID is a v4 one, new each time", () => {
        const resolver = new RandomBasedVariableResolver();
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
        const first = resolve(resolver, "$UUID");
        expect(first).toMatch(uuid);
        expect(resolve(resolver, "$UUID")).not.toBe(first);
    });
});

describe("CompositeSnippetVariableResolver", () => {
    it("the first resolver with a value wins; none is an unknown variable", () => {
        const resolver = new CompositeSnippetVariableResolver([
            new CommentBasedVariableResolver(undefined),
            new CommentBasedVariableResolver({ lineComment: "//" }),
            new CommentBasedVariableResolver({ lineComment: "#" }),
        ]);
        expect(resolve(resolver, "$LINE_COMMENT ${FOO:x}")).toBe("// x");
    });
});
