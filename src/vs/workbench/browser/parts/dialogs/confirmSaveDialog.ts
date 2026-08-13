import { ButtonElement } from "@tuidom/all/ui/button/buttonElement";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/all/ui/layout/hFlexElement";
import { TextLabelElement } from "@tuidom/all/ui/text/textLabelElement";

import { DIALOG_STYLES, DialogComponent } from "./dialogComponent.ts";

// Width of the longest static text line: "   Your changes will be lost if you don't save"
const STATIC_TEXT_MIN_WIDTH = 46;
// "Don't Save"=14, "Cancel"=10, "Save"=8, two spacers=4 → total=36
const BUTTONS_TOTAL_WIDTH = 14 + 2 + 10 + 2 + 8;
const MAX_INNER_WIDTH = 70;
const MAX_FILENAME_DISPLAY = MAX_INNER_WIDTH - 4; // -3 for "   " prefix, -1 for "?" suffix

/**
 * Диалог «сохранить изменения?». Компонент: сервисы в конструктор, view —
 * дерево контролов; цвета — только из активной темы. Живёт один экземпляр
 * на приложение — `DialogService` переиспользует его через {@link setFilename}.
 */
export class ConfirmSaveDialog extends DialogComponent {
    public onSave?: () => void;
    public onDontSave?: () => void;
    public onCancel?: () => void;

    private readonly filenameLabel: TextLabelElement;
    /** Левый спейсер ряда кнопок — его ширина центрирует кнопки под имя файла. */
    private readonly buttonsSpacer: TextLabelElement;

    private readonly dontSaveButton: ButtonElement;
    private readonly cancelButton: ButtonElement;
    private readonly saveButton: ButtonElement;

    public constructor(filename: string) {
        super("confirmSaveDialog");

        this.dontSaveButton = new ButtonElement("Don't Save");
        this.cancelButton = new ButtonElement("Cancel");
        this.saveButton = new ButtonElement("Save");

        this.dontSaveButton.onActivate = () => this.onDontSave?.();
        this.cancelButton.onActivate = () => this.onCancel?.();
        this.saveButton.onActivate = () => this.onSave?.();

        const stack = this.buildFrame("Visual Studio Code");

        // "! " — the "!" is at index 0
        const questionLabel = new TextLabelElement("! Do you want to save the changes you made to");
        questionLabel.setCharStyle(0, { fg: DIALOG_STYLES.warningFg });
        stack.addChild(questionLabel, { width: "stretch", height: 1 });

        this.filenameLabel = new TextLabelElement("");
        stack.addChild(this.filenameLabel, { width: "stretch", height: 1 });
        stack.addChild(new TextLabelElement(""), { width: "stretch", height: 1 });

        const description1 = new TextLabelElement("   Your changes will be lost if you don't save");
        const description2 = new TextLabelElement("   them.");
        description1.style = { fg: DIALOG_STYLES.descriptionFg };
        description2.style = { fg: DIALOG_STYLES.descriptionFg };
        stack.addChild(description1, { width: "stretch", height: 1 });
        stack.addChild(description2, { width: "stretch", height: 1 });
        stack.addChild(new TextLabelElement(""), { width: "stretch", height: 1 });

        this.buttonsSpacer = new TextLabelElement("");
        const row = new HFlexElement();
        row.addChild(this.buttonsSpacer, { width: hflexFixed(0), height: 1 });
        row.addChild(this.dontSaveButton, { width: hflexFit(), height: 1 });
        row.addChild(new TextLabelElement(""), { width: hflexFixed(2), height: 1 });
        row.addChild(this.cancelButton, { width: hflexFit(), height: 1 });
        row.addChild(new TextLabelElement(""), { width: hflexFixed(2), height: 1 });
        row.addChild(this.saveButton, { width: hflexFit(), height: 1 });
        row.addChild(new TextLabelElement(""), { width: hflexFill(), height: 1 });
        stack.addChild(row, { width: "stretch", height: 1 });

        this.setFilename(filename);
    }

    public setFilename(filename: string): void {
        const filenameDisplay =
            filename.length > MAX_FILENAME_DISPLAY ? "..." + filename.slice(-(MAX_FILENAME_DISPLAY - 3)) : filename;
        this.filenameLabel.setText("   " + filenameDisplay + "?");

        const filenameRowWidth = 3 + filenameDisplay.length + 1;
        const naturalInnerWidth = Math.max(STATIC_TEXT_MIN_WIDTH, filenameRowWidth);
        const buttonsLeftPad = Math.floor((naturalInnerWidth - BUTTONS_TOTAL_WIDTH) / 2);
        this.buttonsSpacer.layoutStyle = { width: hflexFixed(buttonsLeftPad), height: 1 };
        // layoutStyle — голое поле, лэйаут сам не перезапустится.
        this.buttonsSpacer.markDirty();
    }

    public focusDefault(): void {
        this.saveButton.focus();
    }

    protected override rowButtons(): readonly ButtonElement[] {
        return [this.dontSaveButton, this.cancelButton, this.saveButton];
    }

    protected override onDismiss(): void {
        this.onCancel?.();
    }
}
