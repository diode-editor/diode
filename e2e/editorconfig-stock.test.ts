import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { homeIsolationEnv } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { findNode } from "./helpers/inspectorClient.ts";
import { DiodeSession } from "./helpers/runDiode.ts";

/**
 * WP9 — сквозная интеграция стокового расширения `EditorConfig.EditorConfig`
 * (немодифицированный `.vsix` из open-vsx) с Diode:
 *
 *   1. установка реального `.vsix` новым CLI-флагом `--install-extension`
 *      (первая проверка установщика WP7.5 на настоящем артефакте);
 *   2. запуск собранного SEA-бинаря и проверка всех свойств EditorConfig на
 *      реальном коде расширения — отступы, trim_trailing_whitespace,
 *      insert_final_newline, end_of_line (LF↔CRLF), charset (graceful degrade),
 *      команда `EditorConfig.generate`, completion в `.editorconfig`.
 *
 * Save-трансформации проверяются по БАЙТАМ на диске (не через inspector).
 * Готовность/состояние UI — через TUIDom-inspector. Ввод — через pty.
 */

const EC_VERSION = "0.18.2";
const EC_ID = "EditorConfig.EditorConfig";

const here = fileURLToPath(new URL(".", import.meta.url));
const VSIX_PATH = path.resolve(here, "fixtures", "editorconfig", `${EC_ID}-${EC_VERSION}.vsix`);
const PROJECT_FIXTURE = path.resolve(here, "fixtures", "editorconfig", "project");

const SAVE = "\x13"; // Ctrl+S → workbench.action.files.save
const CTRL_SPACE = "\x00"; // Ctrl+Space → editor.action.triggerSuggest

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CliResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

function runCli(binary: string, args: readonly string[]): Promise<CliResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
        child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}

// Gated to non-Windows: the suite drives the app through the pty (Ctrl+S, typing,
// Ctrl+Space), and Windows ConPTY does not deliver injected input reliably — the
// same reason the repo's screen-content e2e are Linux-only. The Linux e2e job is
// the reference for this integration proof.
describe.skipIf(process.platform === "win32")("SEA binary — stock editorconfig-vscode integration (WP9)", () => {
    let binary: string;
    let tempRoot: string;
    let userDataDir: string;
    let session: DiodeSession | null = null;

    beforeAll(async () => {
        binary = await getBinaryPath();
        tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "diode-ec-e2e-"));
        userDataDir = path.join(tempRoot, "user-data-root");

        // (1) Install the REAL .vsix via the CLI — exercises WP7.5 on a real artifact.
        const install = await runCli(binary, ["--user-data-dir", userDataDir, "--install-extension", VSIX_PATH]);
        expect(install.stderr).toBe("");
        expect(install.code).toBe(0);
        expect(install.stdout).toContain(`Installed ${EC_ID}@${EC_VERSION}`);

        // Unpacked into the layout the scanner expects, with bundled node_modules.
        const extDir = path.join(userDataDir, "extensions", `${EC_ID}-${EC_VERSION}`);
        expect(fs.existsSync(path.join(extDir, "package.json"))).toBe(true);
        expect(fs.existsSync(path.join(extDir, "out", "editorConfigMain.js"))).toBe(true);
        expect(fs.existsSync(path.join(extDir, "node_modules", "editorconfig", "lib", "index.js"))).toBe(true);
    }, 180_000);

    afterAll(async () => {
        await fs.promises.rm(tempRoot, { recursive: true, force: true });
    });

    afterEach(async () => {
        if (session) {
            await session.dispose();
            session = null;
        }
    });

    /** Fresh copy of the fixture project (tests mutate files on disk). */
    function copyProject(): string {
        const dir = fs.mkdtempSync(path.join(tempRoot, "project-"));
        fs.cpSync(PROJECT_FIXTURE, dir, { recursive: true });
        return dir;
    }

    async function startEditor(files: string[], opts: { cwd?: string } = {}): Promise<DiodeSession> {
        // user-data уже в tempRoot; добавляем изоляцию HOME/XDG (корзина, кеши),
        // чтобы прогон не трогал реальный дом разработчика.
        const s = await DiodeSession.start({
            args: ["--user-data-dir", userDataDir, ...files],
            inspect: true,
            env: homeIsolationEnv(path.join(tempRoot, "home")),
            ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        });
        return s;
    }

    /** Waits until an EditorElement is present in the TUIDom tree (app + file ready). */
    async function waitForEditor(s: DiodeSession): Promise<void> {
        await s.waitForDocument((root) => findNode(root, (n) => n.type === "EditorElement") !== null, {
            timeoutMs: 20_000,
        });
    }

    /**
     * Re-sends Ctrl+S until the file on disk satisfies `predicate` (or times out).
     * `save()` runs the will-save participant unconditionally, so repeating it
     * self-synchronises against the async activation of the extension.
     */
    async function saveUntil(
        s: DiodeSession,
        filePath: string,
        predicate: (bytes: Buffer) => boolean,
        timeoutMs = 25_000,
    ): Promise<Buffer> {
        const deadline = Date.now() + timeoutMs;
        let last = fs.readFileSync(filePath);
        while (Date.now() < deadline) {
            s.write(SAVE);
            await sleep(400);
            last = fs.readFileSync(filePath);
            if (predicate(last)) return last;
        }
        throw new Error(
            `saveUntil timed out for ${path.basename(filePath)}; last bytes: ${JSON.stringify(last.toString("utf8"))}`,
        );
    }

    it("applies indent_size to the active editor (rendered tab width)", async () => {
            // [*.tabbed]: indent_style=tab, indent_size=3 → editorconfig sets tabSize=3 on
            // the active editor via `editor.options`. A literal leading tab then renders 3
            // columns wide. `indent.tabbed` is "\tindented\nend\n": the gutter width is the
            // same on both rows, so (indented.x − end.x) cancels the gutter and equals tabSize.
            // waitFor self-synchronises against the async apply (default tabSize ≠ 3).
            const project = copyProject();
            session = await startEditor([path.join(project, "indent.tabbed")]);
            const screen = await session.waitFor(
                (s) => {
                    const ind = s.findText("indented");
                    const end = s.findText("end");
                    return ind !== null && end !== null && ind.x - end.x === 3;
                },
                { timeoutMs: 20_000 },
            );
            const ind = screen.findText("indented")!;
            const end = screen.findText("end")!;
            expect(ind.x - end.x).toBe(3);
    });

    it("applies trim_trailing_whitespace + insert_final_newline on save (delegated core commands)", async () => {
        const project = copyProject();
        const file = path.join(project, "trim.txt");
        session = await startEditor([file]);
        await waitForEditor(session);

        // [*]: trim_trailing_whitespace=true, insert_final_newline=true.
        // trailing spaces (line 1) + trailing tab (line 2) removed, final newline added.
        const bytes = await saveUntil(session, file, (b) => b.toString("utf8") === "hello\nworld\nno final newline\n");
        expect(bytes.toString("utf8")).toBe("hello\nworld\nno final newline\n");
    });

    it("applies end_of_line=crlf on save (LF → CRLF, byte-checked)", async () => {
        const project = copyProject();
        const file = path.join(project, "eol.crlf");
        session = await startEditor([file]);
        await waitForEditor(session);

        // [*.crlf]: end_of_line=crlf → every line terminator becomes \r\n.
        const bytes = await saveUntil(session, file, (b) => b.includes(Buffer.from("\r\n")));
        expect(bytes.toString("binary")).toBe("line1\r\nline2\r\n");
    });

    it("applies end_of_line=lf on save (CRLF → LF, byte-checked)", async () => {
        const project = copyProject();
        const file = path.join(project, "eol.lf");
        // Fixture is committed with CRLF; assert the starting bytes really are CRLF.
        expect(fs.readFileSync(file).toString("binary")).toBe("line1\r\nline2\r\n");
        session = await startEditor([file]);
        await waitForEditor(session);

        // [*.lf]: end_of_line=lf → CRLF normalised to LF (needs real doc.eol in snapshot).
        const bytes = await saveUntil(session, file, (b) => !b.includes(0x0d));
        expect(bytes.toString("binary")).toBe("line1\nline2\n");
    });

    it("degrades gracefully for an unsupported charset (latin1) without crashing", async () => {
        const project = copyProject();
        const file = path.join(project, "sample.latin");
        session = await startEditor([file]);
        await waitForEditor(session);

        // handleDocumentEncoding → openTextDocument(uri, {encoding:'iso88591'}); WP7 degrades
        // to utf-8 with a warning instead of throwing. Give it a moment, then assert the app
        // is still alive and rendering the editor (no host/subprocess crash).
        await sleep(2_000);
        const root = await session.getDocument();
        expect(session.isExited).toBe(false);
        expect(findNode(root.root, (n) => n.type === "EditorElement")).not.toBeNull();

        // The file is still saveable and stays valid utf-8 (no corruption on degrade).
        const bytes = await saveUntil(session, file, (b) => b.toString("utf8") === "hello latin\n");
        expect(bytes.toString("utf8")).toBe("hello latin\n");
    });

    it("surfaces the editorconfig completion provider in a .editorconfig file (Ctrl+Space)", async () => {
        // EMPTY .editorconfig: the word-based fallback has nothing to offer, so if
        // the completion popup opens with items at all, they came from the stock
        // extension's provider (selector {language:'editorconfig', pattern:'**/.editorconfig'}).
        // Requires languageId resolution for the dotfile (LanguageRegistry FIX WP9).
        const dir = fs.mkdtempSync(path.join(tempRoot, "complete-"));
        const file = path.join(dir, ".editorconfig");
        fs.writeFileSync(file, "");
        session = await startEditor([file]);
        await waitForEditor(session);

        // Poll: re-send Ctrl+Space (self-synchronises against async activation of the
        // provider) until the CompletionListElement is laid out with item rows
        // (box height = itemCount + 2 borders; > 2 means ≥1 populated row).
        const isOpenPopup = (n: { type: string; box: { height: number } }): boolean =>
            n.type === "CompletionListElement" && n.box.height > 2;
        const deadline = Date.now() + 25_000;
        let opened = false;
        while (Date.now() < deadline && !opened) {
            session.write(CTRL_SPACE);
            await sleep(600);
            const { root } = await session.getDocument();
            opened = findNode(root, isOpenPopup) !== null;
        }
        expect(opened).toBe(true);

        // The editorconfig provider offers 8 properties → a multi-row popup.
        const { root } = await session.getDocument();
        const popup = findNode(root, (n) => n.type === "CompletionListElement");
        expect(popup?.box.height).toBeGreaterThan(3);
    });

    it("generates a .editorconfig via the EditorConfig.generate command (palette)", async () => {
        // Empty workspace WITHOUT a .editorconfig; the extension writes into cwd
        // (workspace.workspaceFolders[0] = process.cwd()).
        const workspace = fs.mkdtempSync(path.join(tempRoot, "generate-"));
        const target = path.join(workspace, ".editorconfig");
        expect(fs.existsSync(target)).toBe(false);

        session = await startEditor([workspace], { cwd: workspace });
        // No file opens (dir arg) — wait for the menu bar instead of an editor.
        await session.waitForDocument(
            (root) => findNode(root, (n) => n.type === "TextLabelElement" && n.text?.trim() === "Edit") !== null,
            { timeoutMs: 20_000 },
        );
        // Let activation register EditorConfig.generate (+ its contributed title).
        await sleep(3_000);

        // Open the command palette (Ctrl+P → files mode) and switch to command mode
        // by typing ">", then the command title. Enter runs the highlighted match.
        const deadline = Date.now() + 25_000;
        while (Date.now() < deadline && !fs.existsSync(target)) {
            session.write("\x10"); // Ctrl+P
            await sleep(400);
            session.write(">Generate .editorconfig");
            await sleep(500);
            session.write("\r"); // Enter
            await sleep(800);
        }
        expect(fs.existsSync(target)).toBe(true);
        const generated = fs.readFileSync(target, "utf8");
        expect(generated).toContain("root = true");
        expect(generated).toContain("[*]");
    });
});
