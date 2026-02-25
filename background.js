// Function to handle transliteration from Hebrew to English
function transliterateHebrew(text) {
    const hebrewToLatinMap = {
        'א': 'a','ב': 'b','ג': 'g','ד': 'd','ה': 'h','ו': 'v','ז': 'z',
        'ח': 'kh','ט': 't','י': 'y','כ': 'k','ך': 'k','ל': 'l',
        'מ': 'm','ם': 'm','נ': 'n','ן': 'n','ס': 's','ע': 'a',
        'פ': 'p','ף': 'p','צ': 'ts','ץ': 'ts','ק': 'k',
        'ר': 'r','ש': 'sh','ת': 't',' ': '-'
    };
    return [...text]
    .map(c => hebrewToLatinMap[c] || c)
    .join('');
}

// Function to clean and format the filename
function createFileName(title) {
    const reservedNames = [
        "extensions",
        "settings",
        "downloads",
        "history",
        "newtab",
        "chrome"
    ];

    if (!title) {
        return `TabSnap_window_${Date.now()}.json`;
    }

    let cleanedTitle = title
    .replace(/[!?@#$%^&*()_=+`~[\]\\{}|;:'",<>\/]/g, '')
    .trim();

    if (/[א-ת]/.test(cleanedTitle)) {
        cleanedTitle = transliterateHebrew(cleanedTitle);
    }

    cleanedTitle = cleanedTitle.replace(/\s+/g, '-');
    cleanedTitle = cleanedTitle.replace(/[^a-zA-Z0-9-_]/g, '');

    if (!cleanedTitle || cleanedTitle.length > 200) {
        return `TabSnap_window_${Date.now()}.json`;
    }

    // if reserved name
    const lowerBaseName = cleanedTitle.toLowerCase();
    if (reservedNames.includes(lowerBaseName)) {
        cleanedTitle = `window_${cleanedTitle}_${Date.now()}`;
    }

    return `${cleanedTitle}.json`;
}

// Function to build data model 
function buildWindowData(window) {
    return {
        savedAt: new Date().toISOString(),
        activeTabIndex: window.tabs.findIndex(t => t.active),
        tabs: window.tabs.map(tab => ({
            title: tab.title,
            url: tab.url,
            pinned: tab.pinned
        }))
    };
}

// Function to save data to local storage
function persistWindow(data) {
    return new Promise((resolve) => {
        chrome.storage.local.get("savedWindows", res => {
            const existing = res.savedWindows || {};
            existing[data.savedAt] = data;

            chrome.storage.local.set({ savedWindows: existing }, resolve);
        });
    });
}

// Function to create a file with the relevant data
function downloadWindow(data, fileName, saveAs) {
    console.debug("[downloadWindow] fileName:", fileName);

    const json = JSON.stringify(data, null, 2);
    const url = "data:application/json;base64," + btoa(unescape(encodeURIComponent(json)));
    console.debug("[downloadWindow] full filename path:", `TabSnap/${fileName}`);

    return new Promise((resolve, reject) => {
        chrome.downloads.download(
            {
                url,
                filename: `TabSnap/${fileName}`,
                saveAs
            },
            (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error(
                        "[downloadWindow] download failed:",
                        chrome.runtime.lastError.message
                    );
                    reject(chrome.runtime.lastError);
                    return;
                }

                const listener = (delta) => {
                    if (delta.id === downloadId && delta.state) {
                        if (delta.state.current === "complete") {
                            console.debug(
                                "[downloadWindow] downloadId:",
                                downloadId
                            );
                            chrome.downloads.onChanged.removeListener(listener);
                            resolve(downloadId);
                        }

                        if (delta.state.current === "interrupted") {
                            chrome.downloads.onChanged.removeListener(listener);
                            
                            if (delta.error?.current === "USER_CANCELED") {
                                reject(new Error("USER_CANCELED"));
                            } else {
                                reject(new Error("DOWNLOAD_FAILED"));
                            }
                        }
                    }
                };

                chrome.downloads.onChanged.addListener(listener);
            }
        );
    });
}

// Function to save all window tabs
function saveTabs(window, saveAs) {
    console.debug("[saveTabs] window:", window);

    const data = buildWindowData(window);
    
    const activeTab = window.tabs.find(t => t.active); 
    const fileName = createFileName(activeTab?.title);
    console.debug("[saveTabs] generated fileName:", fileName);

    // save data to local storage
    return persistWindow(data)
        // save data to local file
        .then(() => downloadWindow(data, fileName, saveAs));
}

// Function to save multiple windows
async function saveMultipleWindows(windows, { saveAs = false, closeAfterSave = false }) {
    let successCount = 0;
    const failedWindowIds = [];

    for (const window of windows) {
        try {
            const result = await saveTabs(window, saveAs);

            if (result) { // result?.success
                console.debug('Succeed saving window:', window.id, result);
                successCount++;

                if (closeAfterSave) {
                    await chrome.windows.remove(window.id);
                }
            } else {
                failedWindowIds.push(window.id);
            }

        } catch (error) {
            console.error('Failed saving window:', window.id, error);
            failedWindowIds.push(window.id);
        }
    }

    return {
        successCount,
        totalCount: windows.length,
        failedWindowIds
    };
}

// Function to save ActiveWindow
function saveActiveWindow({ closeAfterSave }) {
    return new Promise((resolve, reject) => {
        chrome.windows.getLastFocused({ populate: true }, window => {
            if (!window || !window.tabs) {
                reject(new Error("No active window"));
                return;
            }

            saveTabs(window, true)
                .then(downloadId => {
                    if (closeAfterSave && downloadId) {
                        chrome.windows.remove(window.id);
                    }
                    resolve(downloadId);
                })
                .catch(reject);
        });
    });
}

chrome.runtime.onInstalled.addListener(() => {
    console.log("TabSnap installed.");
});

function isRestrictedUrl(url) {
    if (!url || typeof url !== "string") {
        return true;
    }

    return (
        url.startsWith("chrome://") ||
        url.startsWith("edge://") ||
        url.startsWith("about:") ||
        url.startsWith("chrome-extension://")
    );
}

function resolveTabUrl(url, index, activeIndex) {
    const isActive = index === activeIndex;

    if (isRestrictedUrl(url) || isActive) {
        return url;
    }

    return (
        chrome.runtime.getURL("lazy.html") +
        "?target=" +
        encodeURIComponent(url)
    );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "saveSingle") {
        saveActiveWindow({ closeAfterSave: message.closeAfterSave })
        .then(() => sendResponse({ status: "success" }))
        .catch(err =>
            sendResponse({ status: "error", message: err.message })
        );
        return true;
    }

    if (message.action === "saveAll" || message.action === "saveSelected") {
        chrome.windows.getAll({ populate: true }, async (windows) => {

            let windowsToSave;

            if (message.action === "saveSelected") {
                windowsToSave = windows.filter(w =>
                    message.windowIds.includes(w.id)
                );
            } else {
                windowsToSave = windows;
            }

            if (!windowsToSave || windowsToSave.length === 0) {
                sendResponse({
                    successCount: 0,
                    totalCount: 0,
                    failedWindowIds: []
                });
                return;
            }

            const summary = await saveMultipleWindows(windowsToSave, {
                saveAs: false,
                closeAfterSave: message.closeAfterSave
            });

            sendResponse(summary);
        });

        return true;
    }

    if (message.action === "restoreTabs") {
        const { tabs, activeTabIndex = 0 } = message;
        // const tabsData = message.tabs;

        if (!tabs || tabs.length === 0) {
            sendResponse({ status: "error" });
            return;
        }

        const safeActiveIndex =
            typeof activeTabIndex === "number" && activeTabIndex >= 0
                ? activeTabIndex
                : 0;

        const firstUrl = resolveTabUrl(
            tabs[0].url,
            0,
            safeActiveIndex
        );

        chrome.windows.create({ url: firstUrl }, function (newWindow) {

            tabs.slice(1).forEach((tabData, indexOffset) => {
                const index = indexOffset + 1;

                chrome.tabs.create({
                    windowId: newWindow.id,
                    url: resolveTabUrl(
                        tabData.url,
                        index,
                        safeActiveIndex
                    ),
                    active: index === safeActiveIndex,
                    pinned: tabData.pinned === true
                });
            });

            sendResponse({ status: "success" });
        });

        return true;
    }
});
