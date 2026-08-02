import { ButtonElement } from "../../../../../../tuidom/ui/button/buttonElement.ts";
import { HFlexElement, hflexFill, hflexFit } from "../../../../../../tuidom/ui/layout/hFlexElement.ts";
import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import { APP_NAME, REPO_URL, VEXX_VERSION } from "../../../../base/common/version.ts";

import { DIALOG_STYLES, DialogComponent } from "./dialogComponent.ts";

/** Диалог «About»: имя, версия, Node, ссылка на репозиторий. */
export class AboutDialog extends DialogComponent {
    public onClose?: () => void;

    private readonly okButton: ButtonElement;

    public constructor() {
        super("aboutDialog");

        this.okButton = new ButtonElement("OK");
        this.okButton.onActivate = () => this.onClose?.();

        const stack = this.buildFrame(APP_NAME);
        stack.addChild(new TextLabelElement(APP_NAME), { width: "stretch", height: 1 });
        stack.addChild(new TextLabelElement(`Version ${VEXX_VERSION}`), { width: "stretch", height: 1 });
        stack.addChild(new TextLabelElement(`Node ${process.version}`), { width: "stretch", height: 1 });

        const link = new TextLabelElement(REPO_URL);
        link.style = { fg: DIALOG_STYLES.linkFg };
        stack.addChild(link, { width: "stretch", height: 1 });
        stack.addChild(new TextLabelElement(""), { width: "stretch", height: 1 });

        const row = new HFlexElement();
        row.addChild(new TextLabelElement(""), { width: hflexFill(), height: 1 });
        row.addChild(this.okButton, { width: hflexFit(), height: 1 });
        stack.addChild(row, { width: "stretch", height: 1 });
    }

    public focusDefault(): void {
        this.okButton.focus();
    }

    protected override rowButtons(): readonly ButtonElement[] {
        return [this.okButton];
    }

    protected override onDismiss(): void {
        this.onClose?.();
    }
}
