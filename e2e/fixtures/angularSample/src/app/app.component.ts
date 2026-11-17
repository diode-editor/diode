import { Component } from "@angular/core";
import { HelloComponent } from "./hello.component";

@Component({
    selector: "app-root",
    imports: [HelloComponent],
    template: `
        <app-hello [name]="title" />
        <span>{{ title.toUpperCase() }}</span>
        <div>{{ nope }}</div>
    `,
})
export class AppComponent {
    title = "diode";
}
