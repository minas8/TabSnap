function applyI18n() {

    // textContent
    document.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.dataset.i18n;
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.textContent = msg;
    });

    // title (tooltips)
    document.querySelectorAll("[data-i18n-title]").forEach(el => {
        const key = el.dataset.i18nTitle;
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.title = msg;
    });

    // placeholder
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
        const key = el.dataset.i18nPlaceholder;
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.placeholder = msg;
    });

    // innerHTML
    document.querySelectorAll("[data-i18n-html]").forEach(el => {
        const key = el.dataset.i18nHtml;
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.innerHTML = msg;
    });
}

function initI18n() {
    const lang = chrome.i18n.getUILanguage();

    if (lang.startsWith("he") || lang.startsWith("ar")) {
        document.documentElement.dir = "rtl";
    } else {
        document.documentElement.dir = "ltr";
    }

    applyI18n();
}

window.addEventListener("error", e => {
    console.error("[popup] uncaught error:", e.error);
});

// Function to display messages to the user
function showMessage(text, type = "success") {

    const icons = {
        success: "check_circle",
        error: "error",
        info: "info"
    };

    const msg = document.createElement("div");
    msg.className = `message ${type}`;

    msg.innerHTML = `
        <span class="material-icons">${icons[type] || "info"}</span>
        <span>${text}</span>
    `;

    const box = document.getElementById("messageBox");
    box.appendChild(msg);

    setTimeout(() => {
        msg.remove();
    }, 3500);
}

// Function to handle file restoration
function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            if (data && data.tabs && Array.isArray(data.tabs)) {
                chrome.runtime.sendMessage(
                    {
                        action: "restoreTabs",
                        tabs: data.tabs,
                        activeTabIndex: data.activeTabIndex ?? 0
                    },
                    (response) => {
                        if (response?.status === "success") {
                            showMessage(chrome.i18n.getMessage("message_window_restored"), "success");
                        } else {
                            showMessage(
                                response?.message || chrome.i18n.getMessage("error_restore_window_failed"), "error");
                        }
                    }
                );
            } else {
                showMessage(chrome.i18n.getMessage("error_invalid_file_format"), "error");
            }
        } catch (e) {
            showMessage(chrome.i18n.getMessage("error_file_read_failed"), "error");
        }
    };
    reader.readAsText(file);
}

// Load and display saved windows from local storage
function loadSavedWindows() {
    chrome.storage.local.get(["savedWindows"], (result) => {
        const container = document.getElementById("savedList");
        container.innerHTML = "";

        const savedObj = result.savedWindows || {};
        const saved = Object.entries(savedObj).map(([id, windowData]) => ({
            id,
            savedAt: windowData.savedAt,
            tabs: windowData.tabs,
            activeTabIndex: windowData.activeTabIndex
        }));

        if (saved.length === 0) {
            const noData = document.createElement("p");
            noData.textContent = chrome.i18n.getMessage("text_no_saved_windows");
            noData.style.textAlign = "center";
            noData.style.color = "#888";
            container.appendChild(noData);
            return;
        }

        saved
            .slice()
            .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
            .forEach(({ id, savedAt, tabs, activeTabIndex }) => {
                const entry = document.createElement("div");
                entry.className = "window-entry";

                const title = document.createElement("strong");
                const tabCount = Array.isArray(tabs) ? tabs.length : 0;
                title.textContent = chrome.i18n.getMessage(
                    "label_saved_window_entry",
                    [new Date(savedAt).toLocaleString(), tabCount]
                );

                entry.appendChild(title);

                const tabList = document.createElement("ul");
                if (!Array.isArray(tabs)) {
                    return;
                }
                tabs.forEach(tab => {
                    const li = document.createElement("li");
                    const link = document.createElement("a");
                    link.href = tab.url;
                    link.textContent = tab.title || tab.url;
                    li.appendChild(link);
                    tabList.appendChild(li);
                });
                entry.appendChild(tabList);

                const restoreBtn = document.createElement("button");
                restoreBtn.className = "restore-btn";
                restoreBtn.title = chrome.i18n.getMessage("tooltip_restore_window");
                restoreBtn.innerHTML = '<span class="material-icons">open_in_new</span>';
                restoreBtn.addEventListener("click", () => {
                    chrome.runtime.sendMessage({
                        action: "restoreTabs",
                        tabs: tabs,
                        activeTabIndex: activeTabIndex
                    });
                });

                const deleteBtn = document.createElement("button");
                deleteBtn.className = "delete-btn";
                deleteBtn.title = chrome.i18n.getMessage("tooltip_delete_window");
                deleteBtn.innerHTML = '<span class="material-icons">delete</span>';
                deleteBtn.addEventListener("click", () => {
                    chrome.storage.local.get(["savedWindows"], (res) => {
                        const current = res.savedWindows || {};
                        delete current[id];
                        chrome.storage.local.set({ savedWindows: current }, loadSavedWindows);
                    });
                });

                entry.appendChild(restoreBtn);
                entry.appendChild(deleteBtn);
                container.appendChild(entry);
            });
    });
}

// Load and display open windows for selection
async function loadOpenWindowsForSelection() {
    const listContainer = document.getElementById("windowSelectorList");
    listContainer.innerHTML = "";

    const windows = await chrome.windows.getAll({ populate: true });

    windows.forEach(window => {
        const activeTab = window.tabs.find(t => t.active);

        let label;
        if (activeTab?.title) {
            label = activeTab.title;
        } else if (activeTab?.url) {
            try {
                const urlObj = new URL(activeTab.url);
                label = urlObj.hostname;
            } catch {
                label = chrome.i18n.getMessage("label_window_with_id", [window.id]);
            }
        } else {
            label = chrome.i18n.getMessage("label_window_with_id", [window.id]);
        }

        const wrapper = document.createElement("div");

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = window.id;

        const text = document.createElement("span");
        text.textContent = chrome.i18n.getMessage(
            "label_window_with_tab_count",
            [label, window.tabs.length]
        );

        wrapper.appendChild(checkbox);
        wrapper.appendChild(text);

        listContainer.appendChild(wrapper);
    });
}

function executeSaveAction(action, payload = {}) {
    const closeAfterSave =
        document.getElementById("closeAfterSaveCheckbox").checked;

    showMessage(chrome.i18n.getMessage("message_saving_windows"), "info");

    chrome.runtime.sendMessage(
        {
            action,
            closeAfterSave,
            ...payload
        },
        response => {

            if (!response) {
                showMessage(chrome.i18n.getMessage("error_background_communication"), "error");
                return;
            }

            const { successCount, totalCount } = response;

            if (successCount > 0) {
                showMessage(chrome.i18n.getMessage(
                    "message_windows_saved_multiple",
                    [successCount, totalCount]
                ), "success");
            } else {
                showMessage(chrome.i18n.getMessage("error_save_all_failed"), "error");
            }
        }
    );
}

// function handleAction(action) {

//     switch (action) {

//         case "saveCurrent":
//             document.getElementById("saveCurrentBtn").click();
//             break;

//         case "saveSelected":
//             document.getElementById("saveSelectedBtn").click();
//             break;

//         case "saveAll":
//             executeSaveAction("saveAll");
//             break;
//     }
// }

// Event listeners
document.addEventListener("DOMContentLoaded", () => {

    initI18n();

    loadSavedWindows();

    // document.body.addEventListener("click", (e) => {

    //     const btn = e.target.closest("[data-action]");
    //     if (!btn) return;

    //     handleAction(btn.dataset.action);
    // });

    // Save Current Window
    document.getElementById("saveCurrentBtn").addEventListener("click", () => {
        const closeAfterSave =
            document.getElementById("closeAfterSaveCheckbox").checked;

        chrome.runtime.sendMessage(
            { action: "saveSingle", closeAfterSave },
            response => {
                console.debug("[popup] saveSingle response:", response);

                if (response?.status === "success") {
                    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                        const activeTab = tabs[0];
                        let extraInfo = "";
                        if (activeTab?.url.startsWith("chrome://")) {
                            extraInfo = chrome.i18n.getMessage("message_chrome_default_filename_used");
                        }
                        showMessage(chrome.i18n.getMessage("message_window_saved_success", [extraInfo]), "success");
                    });
                } else {
                    showMessage(chrome.i18n.getMessage("error_save_window_failed"), "error");
                }
            }
        );
    });

    // Save Selected Windows
    document.getElementById("saveSelectedBtn").addEventListener("click", async () => {
        const selectionArea = document.getElementById("windowSelectionArea");
        const isVisible = selectionArea.style.display === "block";

        if (isVisible) {
            selectionArea.style.display = "none";
            return;
        }

        await loadOpenWindowsForSelection();
        selectionArea.style.display = "block";
    });

    // Save All Windows
    document.getElementById("saveAllBtn").addEventListener("click", () => {
        executeSaveAction("saveAll");
    });

    document.getElementById("confirmSaveSelectedBtn").addEventListener("click", () => {
        const confirmBtn = document.getElementById("confirmSaveSelectedBtn");
        confirmBtn.disabled = true;

        const selectedWindows = Array.from(
            document.querySelectorAll('#windowSelectorList input[type="checkbox"]:checked')
        ).map(cb => parseInt(cb.value));

        if (selectedWindows.length === 0) {
            showMessage(chrome.i18n.getMessage("error_no_windows_selected"), "error");
            confirmBtn.disabled = false;
            return;
        }

        executeSaveAction("saveSelected", {
            windowIds: selectedWindows
        });

        document.getElementById("windowSelectionArea").style.display = "none";

        // re-enable after a short time to prevent double-click
        setTimeout(() => {
            confirmBtn.disabled = false;
        }, 500);
    });


    // File Picker
    document.getElementById("browseLink").addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById("filePicker").click();
    });

    document.getElementById("filePicker").addEventListener("change", (event) => {
        const file = event.target.files[0];
        if (file) {
            handleFile(file);
        }
    });

    // Drag & Drop with UX
    const restoreArea = document.getElementById("restoreArea");

    restoreArea.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.stopPropagation();
        restoreArea.style.borderColor = "blue";
    });

    restoreArea.addEventListener("dragleave", (event) => {
        event.preventDefault();
        event.stopPropagation();
        restoreArea.style.borderColor = "#ccc";
    });

    restoreArea.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        restoreArea.style.borderColor = "#ccc";

        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) {
            return;
        }

        const file = files[0];
        handleFile(file);
    });

    // Clear Local Storage
    document.getElementById("clearLocalBtn").addEventListener("click", () => {
        chrome.storage.local.remove("savedWindows", () => {
        loadSavedWindows();
        });
    });

});
