Project Goal: High-Performance TUI Engine (VS Code Clone)
🎯 Objective
Build a terminal-based text editor from scratch using Node.js & TypeScript. The ultimate goal is to create a console-based VS Code clone capable of running original VS Code extensions via an RPC-based Extension Host.

🏗 Architectural Constraints (NON-NEGOTIABLE)
1. Zero Heavy Frameworks
NO Ink, Blessed, React, or Vue — ничто не должно владеть рендер-циклом, layout'ом или моделью элементов: это ядро проекта (пп. 2-3).

Direct manipulation of process.stdout and process.stdin.

Зависимости — не «поменьше любой ценой», а «простое и фундаментальное»: сфокусированную leaf-библиотеку без транзитивного хвоста брать можно и нужно, если задача фундаментальная, а не наша предметная (`vscode-textmate`, `vscode-oniguruma`, `jsonc-parser`, `chokidar`, `yauzl`). Нельзя — фреймворки и всё, что претендует на архитектуру.

2. Rendering Engine
Grid-based Model: The screen is a 2D matrix of Cell objects (char, fg, bg, styles).

Double Buffering: Always maintain a currentFrame and nextFrame. Perform a diff to send minimal ANSI escape sequences.

TrueColor Support: 24-bit RGB colors by default.

Alternate Screen Buffer: Must use \x1b[?1049h and clean up on SIGINT/exit.

3. Unified UI Model (UIElement)
Every visual component (including the Editor itself) inherits from UIElement.

Integrated Layout & Clipping: * Every element has a box (layout coordinates).

render() method automatically calculates clipRect (intersection of parent and self).

Scroll Support: Every element has scrollOffset. Children are rendered relative to parent.absX - parent.scrollOffset.

Monolithic Awareness: Every element is "visibility-aware". If its box is outside the clipRect, it must skip drawing.

4. Text Handling
Editor Core: The text editor is a specialized UIElement that manages its own internal rendering (not using child UIElements for lines) for performance.

Storage: Data must be stored using a Piece Table (or similar) to support massive files and O(1) undo/redo. (Текущее состояние — Piece Tree эталона за `src/vs/editor/common/model/textDocument.ts`; план ветки A — `docs/TODO/VscodeModel.md`.)

UITextElement: A dedicated element for UI labels with Word Wrap support, where height is calculated based on maxWidth constraints.

5. Reactive Event Loop
No setInterval polling.

The engine "sleeps" until an event (Input, Network, RPC) arrives.

Any state change calls markDirty(), which batches a single tick() via setImmediate().

🛠 Tech Stack
Language: TypeScript (Strict mode).

Runtime: Node.js.

Protocols: LSP (Language Server Protocol), DAP (Debug Adapter Protocol), and a custom RPC for Extension Host.

Input: stdin in Raw Mode with Kitty Keyboard Protocol support for advanced modifiers.