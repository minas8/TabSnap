const params = new URLSearchParams(window.location.search);
const target = params.get("target");

let loaded = false;

function loadTab() {
    if (!loaded && target) {
        loaded = true;
        window.location.replace(target);
    }
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        loadTab();
    }
});