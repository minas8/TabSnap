function applyDirection() {
    const lang = chrome.i18n.getUILanguage();

    if (lang.startsWith("he") || lang.startsWith("ar")) {
        document.documentElement.dir = "rtl";
    } else {
        document.documentElement.dir = "ltr";
    }
}

applyDirection();

window.addEventListener("error", e => {
    console.error("[popup] uncaught error:", e.error);
});

// Function to handle transliteration from Hebrew to English
function transliterateHebrew(text) {
    const transliterationMap = {
        'א': 'a', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v',
        'ז': 'z', 'ח': 'kh', 'ט': 't', 'י': 'y', 'כ': 'k', 'ך': 'k',
        'ל': 'l', 'מ': 'm', 'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's',
        'ע': 'a', 'פ': 'p', 'ף': 'p', 'צ': 'ts', 'ץ': 'ts', 'ק': 'k',
        'ר': 'r', 'ש': 'sh', 'ת': 't', ' ': '-'
    };
    let result = '';
    for (const char of text) {
        result += transliterationMap[char] || char;
    }
    return result;
}

// Function to clean and format the filename
function createFileName(title) {
    let baseName = title;
    
    if (!title || title.startsWith("chrome://") || title.trim() === "") {
        baseName = `TabSnap_window_${Date.now()}`;
    } else {
        baseName = title.replace(/[!?@#$%^&*()_=+`~[\]\\{}|;:'",<>\/]/g, '').trim();

        if (/[א-ת]/.test(baseName)) {
            baseName = transliterateHebrew(baseName);
        }
        
        baseName = baseName.replace(/\s+/g, '-');
    }

    if (!baseName || baseName.length > 200) {
        baseName = `TabSnap_window_${Date.now()}`;
    }

    return `${baseName}.json`;
}

// Function to display messages to the user
function showMessage(text, isSuccess = true) {
    const msg = document.createElement("div");
    msg.textContent = text;
    msg.style.backgroundColor = isSuccess ? "#d4edda" : "#f8d7da";
    msg.style.color = isSuccess ? "#155724" : "#721c24";
    msg.style.border = "1px solid";
    msg.style.borderColor = isSuccess ? "#c3e6cb" : "#f5c6cb";
    msg.style.padding = "5px 10px";
    msg.style.marginBottom = "10px";
    msg.style.borderRadius = "4px";

    const messageBox = document.getElementById("messageBox");
    messageBox.innerHTML = "";
    messageBox.appendChild(msg);
    console.debug("[popup] showMessage:", text);

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
                            showMessage("החלון שוחזר בהצלחה!");
                        } else {
                            showMessage(response?.message || "שגיאה בשחזור החלון.", false);
                        }
                    }
                );
            } else {
                showMessage("פורמט קובץ לא תקין.", false);
            }
        } catch (e) {
            showMessage("שגיאה בקריאת הקובץ. ודא שהוא קובץ JSON תקין.", false);
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
            noData.textContent = "אין שמירות להצגה.";
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
                title.textContent =
                    `${new Date(savedAt).toLocaleString()} | ${tabCount} tabs`;

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
                restoreBtn.title = "שחזר חלון זה";
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
                deleteBtn.title = "מחק חלון זה";
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
                label = `Window ${window.id}`;
            }
        } else {
            label = `Window ${window.id}`;
        }

        const wrapper = document.createElement("div");

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = window.id;

        const text = document.createElement("span");
        text.textContent = ` ${label} (${window.tabs.length} tabs)`;

        wrapper.appendChild(checkbox);
        wrapper.appendChild(text);

        listContainer.appendChild(wrapper);
    });
}

function executeSaveAction(action, payload = {}) {
    const closeAfterSave =
        document.getElementById("closeAfterSaveCheckbox").checked;

    showMessage("שומר חלונות, נא להמתין...");

    chrome.runtime.sendMessage(
        {
            action,
            closeAfterSave,
            ...payload
        },
        response => {

            if (!response) {
                showMessage("שגיאה בתקשורת עם הרקע.", false);
                return;
            }

            const { successCount, totalCount } = response;

            if (successCount > 0) {
                showMessage(`${successCount} מתוך ${totalCount} חלונות נשמרו בהצלחה.`);
            } else {
                showMessage("השמירה נכשלה עבור כל החלונות.", false);
            }
        }
    );
}

// Event listeners
document.addEventListener("DOMContentLoaded", () => {
    loadSavedWindows();

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
                            extraInfo = " עבור הטאב הזה Chrome השתמש בשם הקובץ ברירת מחדל (`download.json`) בשל מגבלות מערכת ההפעלה.";
                        }
                        showMessage("החלון נשמר בהצלחה!" + extraInfo);
                    });
                } else {
                    showMessage("שגיאה בשמירת החלון.", false);
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
            showMessage("לא נבחרו חלונות לשמירה.", false);
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
