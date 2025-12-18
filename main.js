// element-plugin-usernamecolors/main.js

(function () {
    const PLUGIN_TAG = "[element-plugin-usernamecolors]";
    const USER_PREFS_EVENT = "dev.mates.user_prefs";

    /**
     * Wait for the Matrix client to be available via mxMatrixClientPeg.
     * @returns {Promise<any>} Client instance
     */
    function waitForClient() {
        return new Promise((resolve) => {
            const interval = setInterval(() => {
                const peg = window.mxMatrixClientPeg;
                const client = peg && typeof peg.get === "function" ? peg.get() : null;
                if (client) {
                    clearInterval(interval);
                    resolve(client);
                }
            }, 400);
        });
    }

    /**
     * Check if a room is a Space by inspecting m.room.create content.type === "m.space".
     * @param {any} room
     * @returns {boolean}
     */
    function isSpaceRoom(room) {
        const state = room && room.currentState;
        if (!state || typeof state.getStateEvents !== "function") return false;
        const ev = state.getStateEvents("m.room.create", "");
        const e = Array.isArray(ev) ? ev[0] : ev;
        if (!e) return false;
        const content = typeof e.getContent === "function" ? e.getContent() : e.content;
        return !!content && content.type === "m.space";
    }

    /**
     * Resolve the current Space room by reading the room list header title.
     * Returns null when not in a Space context.
     * @param {any} client
     * @returns {any|null}
     */
    function findCurrentSpaceRoom(client) {
        try {
            const header = document.querySelector(".mx_RoomListHeaderView_title h1[title]");
            const headerName = header ? (header.getAttribute("title") || header.textContent || "").trim() : "";
            if (!headerName || headerName.toLowerCase() === "home") return null;
            const rooms = typeof client.getRooms === "function" ? client.getRooms() : [];
            return rooms.find(r => r && (r.name || "").trim() === headerName && isSpaceRoom(r)) || null;
        } catch {
            return null;
        }
    }

    /**
     * Merge and persist a partial object for a specific user in a given room (space).
     * Stores as state event type USER_PREFS_EVENT with state key = userId.
     * @param {string} roomId
     * @param {string} userId
     * @param {Record<string, any>} partial
     * @returns {Promise<void>}
     */
    async function setUserDataInRoom(roomId, userId, partial) {
        if (!roomId || !userId || typeof partial !== "object") return;
        const client = await waitForClient();
        const room = client.getRoom && client.getRoom(roomId);
        const state = room && room.currentState;
        let existing = {};
        if (state && typeof state.getStateEvents === "function") {
            const ev = state.getStateEvents(USER_PREFS_EVENT, userId);
            const e = Array.isArray(ev) ? ev[0] : ev;
            const content = e && (typeof e.getContent === "function" ? e.getContent() : e.content);
            if (content && typeof content === "object") existing = content;
        }
        const next = { ...existing, ...partial };
        await client.sendStateEvent(roomId, USER_PREFS_EVENT, next, userId);
    }

    /**
     * Read a specific user's data from a room (space) state.
     * @param {string} roomId
     * @param {string} userId
     * @returns {Promise<Record<string, any>>}
     */
    async function getUserDataFromRoom(roomId, userId) {
        if (!roomId || !userId) return {};
        const client = await waitForClient();
        const room = client.getRoom && client.getRoom(roomId);
        const state = room && room.currentState;
        if (!state || typeof state.getStateEvents !== "function") return {};
        const ev = state.getStateEvents(USER_PREFS_EVENT, userId);
        const e = Array.isArray(ev) ? ev[0] : ev;
        const content = e && (typeof e.getContent === "function" ? e.getContent() : e.content);
        return content && typeof content === "object" ? content : {};
    }

    /**
     * Convenience setter for a user color field.
     * @param {string} userId
     * @param {string} color Any valid CSS color
     * @returns {Promise<void>}
     */
    /**
     * Convenience: set user color in a space. If roomId not provided, uses current space.
     * @param {string} userId
     * @param {string} color
     * @param {string=} roomId
     */
    async function setUserColor(userId, color, roomId) {
        const client = await waitForClient();
        let targetRoomId = roomId;
        if (!targetRoomId) {
            const space = findCurrentSpaceRoom(client);
            targetRoomId = space && space.roomId;
        }
        if (!targetRoomId) return;
        await setUserDataInRoom(targetRoomId, userId, { color });
    }

    /**
     * Optional: share a single user's data into a room state event so others can consume it.
     * Uses custom state event type with state key = userId.
     * Consumers should be prepared to trust only from allowed users.
     * @param {string} roomId
     * @param {string} userId
     * @returns {Promise<void>}
     */
    async function shareUserDataToRoom(roomId, userId) {
        // No-op retained for API compatibility; data already lives in room state.
        return;
    }

    /**
     * Optional: read a user's shared data from a room state event.
     * @param {string} roomId
     * @param {string} userId
     * @returns {Promise<Record<string, any>>}
     */
    async function getSharedUserDataFromRoom(roomId, userId) {
        return getUserDataFromRoom(roomId, userId);
    }

    /**
     * Attach a logger that prints sender/user info whenever a message is sent in any room.
     */
    async function attachMessageLogger() {
        const client = await waitForClient();
        const myUserId = typeof client.getUserId === "function" ? client.getUserId() : null;

        function mxcToHttp(mxc, w = 48, h = 48) {
            try {
                if (!mxc || !client.mxcUrlToHttp) return null;
                return client.mxcUrlToHttp(mxc, w, h, "crop");
            } catch { return null; }
        }

        async function readMyAccountColor() {
            try {
                const ev = client.getAccountData && client.getAccountData(USER_PREFS_EVENT);
                const content = ev && (typeof ev.getContent === "function" ? ev.getContent() : ev.content);
                return (content && typeof content.color === "string") ? content.color : null;
            } catch { return null; }
        }

        if (typeof client.on === "function") {
            client.on("Room.timeline", async (event, room, toStartOfTimeline) => {
                try {
                    const type = (event && typeof event.getType === "function") ? event.getType() : event && event.type;
                    if (type !== "m.room.message") return;
                    if (!room || toStartOfTimeline) return;

                    const sender = (event && typeof event.getSender === "function") ? event.getSender() : event && event.sender;
                    if (!sender) return;

                    const member = room.getMember ? room.getMember(sender) : null;
                    const membership = member && member.membership || null;
                    const displayName = member && (member.name || member.rawDisplayName) || sender;
                    const avatarMxc = (member && typeof member.getMxcAvatarUrl === "function") ? member.getMxcAvatarUrl() : null;
                    const avatarHttp = mxcToHttp(avatarMxc, 48, 48) || null;

                    const content = (typeof event.getContent === "function" ? event.getContent() : event && event.content) || {};
                    const msgtype = content.msgtype || null;
                    const body = content.body || null;

                    const perRoomPrefs = await getUserDataFromRoom(room.roomId, sender);
                    const accountColor = sender === myUserId ? await readMyAccountColor() : null;

                    // eslint-disable-next-line no-console
                    console.log(PLUGIN_TAG, "[message]", {
                        room: { id: room.roomId, name: room.name },
                        eventId: (typeof event.getId === "function" ? event.getId() : event && event.event_id) || null,
                        sender,
                        displayName,
                        membership,
                        avatarHttp,
                        msgtype,
                        body,
                        perRoomPrefs,
                        accountColor,
                    });
                } catch (e) {
                    // eslint-disable-next-line no-console
                    console.error(PLUGIN_TAG, "message logger error", e);
                }
            });
        }
    }

    /**
     * Setup a small UI block on Settings → Account to manage the user color.
     * Stores color in account data (user-owned, server-synced). Optionally publishes
     * to the current space as room state for others to consume.
     */
    function setupAccountSettingsBox() {
        const BOX_ID = "mates-account-color-box";

        /**
         * Read color from account data.
         * @returns {Promise<string|null>}
         */
        async function readAccountColor() {
            try {
                const client = await waitForClient();
                const ev = typeof client.getAccountData === "function" ? client.getAccountData(USER_PREFS_EVENT) : null;
                const content = ev && (typeof ev.getContent === "function" ? ev.getContent() : ev.content);
                const color = content && typeof content.color === "string" ? content.color : null;
                return color;
            } catch { return null; }
        }

        /**
         * Write color to account data (merge-safe).
         * @param {string} color
         */
        async function writeAccountColor(color) {
            const client = await waitForClient();
            let content = {};
            try {
                const ev = client.getAccountData && client.getAccountData(USER_PREFS_EVENT);
                const curr = ev && (typeof ev.getContent === "function" ? ev.getContent() : ev.content);
                if (curr && typeof curr === "object") content = { ...curr };
            } catch {}
            content.color = color;
            await client.setAccountData(USER_PREFS_EVENT, content);
        }

        function findAccountTabContainer() {
            // Target the specific user settings dialog to avoid collisions
            const dialog = document.querySelector('.mx_UserSettingsDialog');
            if (!dialog) return null;

            // Prefer the currently selected tab in the left tab list
            const selectedTab = dialog.querySelector('.mx_TabbedView_tabLabels [role="tab"][aria-selected="true"]');
            if (selectedTab) {
                const labelText = (selectedTab.textContent || '').trim();
                if (/^account$/i.test(labelText)) {
                    const panelId = selectedTab.getAttribute('aria-controls') || 'mx_tabpanel_USER_ACCOUNT_TAB';
                    const panel = document.getElementById(panelId) || dialog.querySelector(`#${panelId}`);
                    if (panel) {
                        // Insert into the standard content area if available
                        const subSections = panel.querySelector('.mx_SettingsSection_subSections');
                        if (subSections) return subSections;
                        const panelContent = panel.querySelector('.mx_TabbedView_tabPanelContent');
                        if (panelContent) return panelContent;
                        const settingsTab = panel.querySelector('.mx_SettingsTab');
                        if (settingsTab) return settingsTab;
                        return panel;
                    }
                }
            }

            // Fallback: verify the dialog title says Settings: Account
            const title = dialog.querySelector('.mx_UserSettingsDialog_title');
            const titleText = title ? (title.textContent || '').toLowerCase() : '';
            if (titleText.includes('settings:') && titleText.includes('account')) {
                // Try the known account panel id, else any visible tab panel
                const fallbackPanel = document.getElementById('mx_tabpanel_USER_ACCOUNT_TAB')
                    || dialog.querySelector('.mx_TabbedView_tabPanel');
                if (fallbackPanel) {
                    const subSections = fallbackPanel.querySelector('.mx_SettingsSection_subSections');
                    if (subSections) return subSections;
                    const panelContent = fallbackPanel.querySelector('.mx_TabbedView_tabPanelContent');
                    if (panelContent) return panelContent;
                    const settingsTab = fallbackPanel.querySelector('.mx_SettingsTab');
                    if (settingsTab) return settingsTab;
                    return fallbackPanel;
                }
            }

            return null;
        }

        async function createBox(container) {
            if (!container || document.getElementById(BOX_ID)) return;
            const wrapper = document.createElement("div");
            wrapper.id = BOX_ID;
            wrapper.style.cssText = `
                margin: 16px 0;
                padding: 12px;
                border: 1px solid var(--cpd-color-border-interactive-secondary, #3a3a3a);
                border-radius: 8px;
            `;

            const title = document.createElement("div");
            title.textContent = "Mates: User Color";
            title.style.cssText = `
                font-weight: 600;
                margin-bottom: 8px;
            `;

            const row = document.createElement("div");
            row.style.cssText = `
                display: flex;
                gap: 8px;
                align-items: center;
                flex-wrap: wrap;
            `;

            const colorInput = document.createElement("input");
            colorInput.type = "color";
            colorInput.value = "#7c3aed";
            colorInput.style.width = "40px";
            colorInput.style.height = "28px";
            colorInput.style.padding = "0";
            colorInput.style.border = "none";
            colorInput.style.background = "transparent";

            const textInput = document.createElement("input");
            textInput.type = "text";
            textInput.placeholder = "#RRGGBB or CSS color";
            textInput.style.flex = "1";
            textInput.style.minWidth = "160px";
            textInput.style.padding = "6px 8px";

            const saveBtn = document.createElement("button");
            saveBtn.textContent = "Save color";
            saveBtn.style.padding = "6px 10px";

            const publishBtn = document.createElement("button");
            publishBtn.textContent = "Publish to current space";
            publishBtn.style.padding = "6px 10px";

            const status = document.createElement("span");
            status.style.cssText = "margin-left: 8px; opacity: 0.8; font-size: 12px;";

            colorInput.addEventListener("input", () => {
                textInput.value = colorInput.value;
            });
            textInput.addEventListener("input", () => {
                // Keep in sync if hex-like
                const v = textInput.value.trim();
                if (/^#[0-9a-fA-F]{6}$/.test(v)) colorInput.value = v;
            });

            saveBtn.addEventListener("click", async () => {
                const v = (textInput.value || colorInput.value || "").trim();
                try {
                    await writeAccountColor(v);
                    status.textContent = "Saved";
                } catch (e) {
                    status.textContent = "Save failed";
                    // eslint-disable-next-line no-console
                    console.error(PLUGIN_TAG, e);
                }
            });

            publishBtn.addEventListener("click", async () => {
                const v = (textInput.value || colorInput.value || "").trim();
                try {
                    const client = await waitForClient();
                    const me = typeof client.getUserId === "function" ? client.getUserId() : null;
                    const space = findCurrentSpaceRoom(client);
                    if (!me || !space) {
                        status.textContent = "Open a space to publish";
                        return;
                    }
                    await setUserDataInRoom(space.roomId, me, { color: v });
                    status.textContent = "Published to space";
                } catch (e) {
                    status.textContent = "Publish failed";
                    // eslint-disable-next-line no-console
                    console.error(PLUGIN_TAG, e);
                }
            });

            row.appendChild(colorInput);
            row.appendChild(textInput);
            row.appendChild(saveBtn);
            row.appendChild(publishBtn);
            row.appendChild(status);

            wrapper.appendChild(title);
            wrapper.appendChild(row);
            container.appendChild(wrapper);

            try {
                const current = await readAccountColor();
                if (typeof current === "string" && current) {
                    textInput.value = current;
                    if (/^#[0-9a-fA-F]{6}$/.test(current)) colorInput.value = current;
                }
            } catch {}
        }

        const observer = new MutationObserver(() => {
            const container = findAccountTabContainer();
            if (container) createBox(container);
        });
        // Watch both the dialog and body to catch tab/content changes
        const dialogNode = () => document.querySelector('.mx_UserSettingsDialog') || document.body;
        observer.observe(dialogNode(), { childList: true, subtree: true, attributes: true, characterData: true });

        // Initial attempt
        const initial = findAccountTabContainer();
        if (initial) createBox(initial);
    }

    /**
     * Attach a small API onto window for easy use from devtools or other plugins.
     */
    async function start() {
        await waitForClient();
        const api = {
            setInRoom: setUserDataInRoom,
            getFromRoom: getUserDataFromRoom,
            setColor: setUserColor,
            shareToRoom: shareUserDataToRoom,
            getSharedFromRoom: getSharedUserDataFromRoom,
        };
        window.matesUserData = api;
        console.log(PLUGIN_TAG, "User-data API ready: window.matesUserData");

        // Settings: Account UI
        setupAccountSettingsBox();

        // Message logger
        attachMessageLogger();
    }

    start().catch((e) => console.error(PLUGIN_TAG, e));
})();