<script lang="ts">
    import Button from "./Button.svelte";
    import { greet, type User } from "./util";

    let count = 0;
    let user: User = { name: "Ann" };
    function increment() {
        count += 1;
    }
</script>

<main>
    <h1>{greet(user)}</h1>
    <Button label="Add" on:click={increment} />
    <p>{count} {unknownVar}</p>
</main>
