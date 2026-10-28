/* GENZ TEEN CHAT
   Appwrite-backed: account signup/sign-in and public messages.
   Browser-only starter features: profile preferences, friends, notifications,
   block list, and report log. These are NOT shared between accounts/devices yet.
   Never add an Appwrite API key to browser code.
*/
(() => {
  "use strict";

  // 1) Replace these values with your own Appwrite project details.
  const APPWRITE_ENDPOINT = "https://cloud.appwrite.io/v1"; // Use the endpoint shown in your Appwrite project.
  const APPWRITE_PROJECT_ID = "PASTE_YOUR_PROJECT_ID_HERE";
  const DATABASE_ID = "PASTE_YOUR_DATABASE_ID_HERE";
  const MESSAGES_TABLE_ID = "messages"; // Public chat table.
  const PRIVATE_FUNCTION_URL = "https://starter-function-pw9b.nyc.appwrite.run";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const storageKey = "genzTeenChatLocalV1";
  let authMode = "login";
  let currentUser = null;
  let profile = { name: "", bio: "", photo: "" };
  let localData = { friends: [], notifications: [], blocked: [], reports: [] };
  let toastTimeout;
  let realtimeUnsubscribe = null;
  let appwriteReady = false;
  let activePrivateUserId = "";

  const client = new Appwrite.Client();
  client.setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);
  const account = new Appwrite.Account(client);
  const tablesDB = new Appwrite.TablesDB(client);

  function configured() {
    return APPWRITE_PROJECT_ID !== "PASTE_YOUR_PROJECT_ID_HERE" &&
      DATABASE_ID !== "PASTE_YOUR_DATABASE_ID_HERE" &&
      APPWRITE_PROJECT_ID.trim() !== "" && DATABASE_ID.trim() !== "";
  }

  function loadLocalData() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || "{}");
      profile = { ...profile, ...(parsed.profile || {}) };
      localData = { ...localData, ...(parsed.data || {}) };
    } catch (error) {
      console.warn("Could not load local preferences", error);
    }
  }

  function saveLocalData() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ profile, data: localData }));
    } catch (error) {
      console.warn("Could not save local preferences", error);
    }
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 3000);
  }

  function setConnectionStatus(message, connected = false) {
    const pill = $("#connection-status");
    pill.textContent = message;
    pill.classList.toggle("connected", connected);
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function displayName(user = currentUser) {
    return (profile.name || user?.name || user?.email?.split("@")[0] || "Friend").slice(0, 30);
  }

  async function callPrivateApi(payload) {
    if (!currentUser) throw new Error("Sign in first.");
    const token = await account.createJWT();
    const response = await fetch(PRIVATE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Appwrite-User-JWT": token.jwt,
        "X-Appwrite-Project": APPWRITE_PROJECT_ID
      },
      body: JSON.stringify(payload)
    });
    let result;
    try { result = await response.json(); } catch (_) { result = {}; }
    if (!response.ok || !result.ok) throw new Error(result.error || `Private messaging request failed (${response.status}).`);
    return result;
  }

  function renderPrivateMessages(messages) {
    const target = $("#private-chat-feed");
    if (!Array.isArray(messages) || !messages.length) {
      target.innerHTML = `<div class="empty-state">No messages in this conversation yet. Say hello kindly.</div>`;
      return;
    }
    target.innerHTML = messages.map((message) => {
      const mine = message.senderId === currentUser?.$id;
      const when = message.sentAt ? new Date(message.sentAt) : null;
      const time = when && !Number.isNaN(when.getTime()) ? when.toLocaleString() : "";
      return `<article class="private-message ${mine ? "mine" : "theirs"}"><div class="private-message-meta"><strong>${mine ? "You" : "Other member"}</strong><span>${escapeHTML(time)}</span></div><p>${escapeHTML(message.messageText || "")}</p></article>`;
    }).join("");
    target.scrollTop = target.scrollHeight;
  }

  async function loadPrivateConversation() {
    if (!activePrivateUserId || !currentUser) return;
    const feed = $("#private-chat-feed");
    feed.innerHTML = `<div class="empty-state">Loading private messages…</div>`;
    try {
      const result = await callPrivateApi({ action: "list", otherUserId: activePrivateUserId });
      renderPrivateMessages(result.messages);
    } catch (error) {
      feed.innerHTML = `<div class="empty-state">${escapeHTML(error.message || "Could not load this conversation.")}</div>`;
    }
  }

  async function openPrivateConversation(event) {
    event.preventDefault();
    const otherId = $("#private-user-id").value.trim();
    if (!otherId || otherId === currentUser?.$id) return showToast("Enter another member's User ID.");
    activePrivateUserId = otherId;
    $("#private-chat-title").textContent = `Member: ${otherId.slice(0, 14)}${otherId.length > 14 ? "…" : ""}`;
    $("#private-conversation").classList.remove("hidden");
    await loadPrivateConversation();
  }

  async function sendPrivateMessage(event) {
    event.preventDefault();
    const input = $("#private-message-input");
    const messageText = input.value.trim();
    if (!activePrivateUserId) return showToast("Open a conversation first.");
    if (!messageText) return;
    const button = $("#private-message-form button[type='submit']");
    button.disabled = true;
    try {
      await callPrivateApi({ action: "send", receiverId: activePrivateUserId, messageText });
      input.value = "";
      await loadPrivateConversation();
      showToast("Private message sent.");
    } catch (error) {
      showToast(error.message || "Private message was not sent.");
    } finally { button.disabled = false; input.focus(); }
  }

  async function blockUserId(userId) {
    const id = String(userId || "").trim();
    if (!id || id === currentUser?.$id) return showToast("Enter another member's User ID.");
    try {
      await callPrivateApi({ action: "block", blockedId: id });
      if (!localData.blocked.some((item) => item.toLowerCase() === id.toLowerCase())) localData.blocked.push(id);
      saveLocalData(); renderBlocked();
      showToast("User blocked. Private messaging between you is disabled.");
      if (activePrivateUserId === id) {
        $("#private-chat-feed").innerHTML = `<div class="empty-state">This conversation is unavailable because one user blocked the other.</div>`;
      }
    } catch (error) { showToast(error.message || "Could not block this user."); }
  }

  async function reportUserId(userId, reason = "Safety concern reported from private chat") {
    const id = String(userId || "").trim();
    if (!id || id === currentUser?.$id) return showToast("Choose another member to report.");
    try {
      await callPrivateApi({ action: "report", reportedUserId: id, reason });
      showToast("Report submitted. A moderator dashboard still needs to be set up.");
      addNotification("Your safety report was submitted.");
    } catch (error) { showToast(error.message || "Could not submit the report."); }
  }

  function setAvatar(element, name, photo = "") {
    if (!element) return;
    if (photo && /^https?:\/\//i.test(photo)) {
      element.innerHTML = `<img src="${escapeHTML(photo)}" alt="" referrerpolicy="no-referrer">`;
      const img = element.querySelector("img");
      img.addEventListener("error", () => { element.textContent = (name || "G").slice(0, 1).toUpperCase(); }, { once: true });
    } else {
      element.textContent = (name || "G").trim().slice(0, 1).toUpperCase() || "G";
    }
  }

  function addNotification(text) {
    localData.notifications.unshift({ id: crypto.randomUUID?.() || String(Date.now()), text, time: new Date().toISOString() });
    localData.notifications = localData.notifications.slice(0, 30);
    saveLocalData();
    renderNotifications();
  }

  function renderProfile() {
    $("#profile-display-name").textContent = displayName();
    $("#profile-email").textContent = currentUser?.email || "Signed in";
    setAvatar($("#profile-avatar"), displayName(), profile.photo);
  }

  function setAuthMode(mode) {
    authMode = mode;
    $$(".auth-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.authMode === mode));
    const signup = mode === "signup";
    $("#auth-title").textContent = signup ? "Join the community" : "Welcome back";
    $("#auth-subtitle").textContent = signup ? "Create your account to join the conversation." : "Sign in to join the conversation.";
    $("#auth-name").classList.toggle("hidden", !signup);
    $("#name-label").classList.toggle("hidden", !signup);
    $("#auth-name").required = signup;
    $("#auth-password").autocomplete = signup ? "new-password" : "current-password";
    $("#auth-submit").textContent = signup ? "Create account" : "Sign in";
    $("#auth-message").textContent = "";
  }

  function showWorkspace(user) {
    currentUser = user;
    if (!profile.name) profile.name = (user.name || user.email?.split("@")[0] || "Friend").slice(0, 30);
    $("#auth-screen").classList.add("hidden");
    $("#chat-app").classList.remove("hidden");
    $("#signout-button").classList.remove("hidden");
    renderProfile();
    renderFriends();
    renderNotifications();
    renderBlocked();
    setConnectionStatus(configured() ? "Appwrite connected" : "Add project details", configured());
    if (configured()) {
      loadPublicMessages();
      subscribeRealtime();
    } else {
      $("#chat-feed").innerHTML = `<div class="empty-state">Add your Appwrite Project ID and Database ID in <code>script.js</code> to load public chat.</div>`;
    }
  }

  function showAuth() {
    currentUser = null;
    $("#auth-screen").classList.remove("hidden");
    $("#chat-app").classList.add("hidden");
    $("#signout-button").classList.add("hidden");
    setConnectionStatus("Not signed in");
    if (realtimeUnsubscribe) {
      try { realtimeUnsubscribe(); } catch (_) {}
      realtimeUnsubscribe = null;
    }
  }

  async function handleAuth(event) {
    event.preventDefault();
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    const name = $("#auth-name").value.trim();
    const button = $("#auth-submit");
    const message = $("#auth-message");
    message.textContent = "";
    if (!configured()) {
      message.textContent = "First add your Project ID and Database ID in script.js.";
      return;
    }
    button.disabled = true;
    button.textContent = authMode === "signup" ? "Creating account…" : "Signing in…";
    try {
      if (authMode === "signup") {
        if (name.length < 2) throw new Error("Choose a display name with at least 2 characters.");
        await account.create({ userId: Appwrite.ID.unique(), email, password, name });
        await account.createEmailPasswordSession({ email, password });
        profile.name = name;
        saveLocalData();
        addNotification("Welcome to GENZ TEEN CHAT. Be kind and stay safe!");
      } else {
        await account.createEmailPasswordSession({ email, password });
      }
      const user = await account.get();
      showWorkspace(user);
      showToast("You're signed in. Welcome!");
    } catch (error) {
      message.textContent = error?.message || "We couldn't sign you in. Check the details and try again.";
    } finally {
      button.disabled = false;
      button.textContent = authMode === "signup" ? "Create account" : "Sign in";
    }
  }

  async function handleSignOut() {
    try { await account.deleteSession({ sessionId: "current" }); } catch (error) { console.warn(error); }
    showAuth();
    showToast("You have signed out.");
  }

  function renderMessages(rows) {
    const feed = $("#chat-feed");
    const blocked = new Set(localData.blocked.map((n) => n.toLowerCase()));
    const visibleRows = (rows || []).filter((row) => !blocked.has(String(row.userId || "").toLowerCase()) && !blocked.has(String(row.senderName || "").toLowerCase()));
    if (!visibleRows.length) {
      feed.innerHTML = `<div class="empty-state">No messages yet. Be the first to say hello! 👋</div>`;
      return;
    }
    feed.innerHTML = visibleRows.map((row) => {
      const sender = String(row.senderName || "Community member");
      const text = String(row.messageText || "");
      const date = row.$createdAt ? new Date(row.$createdAt) : null;
      const time = date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
      const mine = currentUser && row.userId === currentUser.$id;
      return `<article class="chat-message" data-message-id="${escapeHTML(row.$id || "")}">
        <div class="message-avatar">${escapeHTML(sender.trim().slice(0,1).toUpperCase() || "G")}</div>
        <div class="message-content">
          <div class="message-meta"><strong>${escapeHTML(sender)}${mine ? " (you)" : ""}</strong><span class="message-time">${escapeHTML(time)}</span></div>
          <p class="message-text">${escapeHTML(text)}</p>
          <div class="message-tools">
            <button type="button" data-react="💙" aria-label="React with heart">💙 React</button>
            <button type="button" data-react="😂" aria-label="React with laughing face">😂 React</button>
            <button type="button" data-report-message="${escapeHTML(sender)}" data-report-user-id="${escapeHTML(row.userId || "")}">🚩 Report</button>
            ${mine ? `<button type="button" data-delete-message="${escapeHTML(row.$id || "")}">Delete</button>` : `<button type="button" data-block-message="${escapeHTML(sender)}" data-block-user-id="${escapeHTML(row.userId || "")}">Block</button>`}
          </div>
        </div>
      </article>`;
    }).join("");
  }

  async function loadPublicMessages() {
    if (!configured() || !currentUser) return;
    try {
      const response = await tablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: MESSAGES_TABLE_ID,
        queries: [Appwrite.Query.orderDesc("$createdAt"), Appwrite.Query.limit(100)]
      });
      renderMessages((response.rows || []).reverse());
      setConnectionStatus("Appwrite connected", true);
    } catch (error) {
      console.error("Could not load messages:", error);
      setConnectionStatus("Check table permissions", false);
      $("#chat-feed").innerHTML = `<div class="empty-state">Couldn't load messages. Check that the table ID is correct and signed-in users have read permission. Details: ${escapeHTML(error.message || "Appwrite request failed")}</div>`;
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const input = $("#message-input");
    const messageText = input.value.trim();
    if (!messageText) return;
    if (!currentUser) return showToast("Sign in before sending a message.");
    if (!configured()) return showToast("Add your Appwrite project and database IDs in script.js first.");
    if (messageText.length > 1000) return showToast("Messages must be 1000 characters or fewer.");
    const button = $("#message-form button[type='submit']");
    button.disabled = true;
    try {
      await tablesDB.createRow({
        databaseId: DATABASE_ID,
        tableId: MESSAGES_TABLE_ID,
        rowId: Appwrite.ID.unique(),
        data: {
          senderName: displayName(),
          messageText,
          userId: currentUser.$id
        }
      });
      input.value = "";
      $("#char-count").textContent = "0 / 1000";
      $("#emoji-picker").classList.add("hidden");
      await loadPublicMessages();
    } catch (error) {
      console.error("Could not send message:", error);
      showToast(`Message not sent: ${error.message || "check Appwrite permissions"}`);
    } finally {
      button.disabled = false;
      input.focus();
    }
  }

  function subscribeRealtime() {
    if (!configured() || !client.subscribe || realtimeUnsubscribe) return;
    try {
      realtimeUnsubscribe = client.subscribe(
        [`databases.${DATABASE_ID}.tables.${MESSAGES_TABLE_ID}.rows`],
        () => loadPublicMessages()
      );
    } catch (error) {
      console.warn("Realtime subscription could not start; use Refresh instead.", error);
    }
  }

  async function deleteMessage(rowId) {
    if (!rowId || !currentUser) return;
    if (!confirm("Delete this message?")) return;
    try {
      await tablesDB.deleteRow({ databaseId: DATABASE_ID, tableId: MESSAGES_TABLE_ID, rowId });
      showToast("Message deleted.");
      await loadPublicMessages();
    } catch (error) {
      showToast("Could not delete it. Appwrite row permissions may prevent this.");
    }
  }

  function renderFriends() {
    $("#friend-count").textContent = String(localData.friends.length);
    const target = $("#friends-list");
    if (!localData.friends.length) {
      target.innerHTML = `<div class="empty-state">No friends added yet. Add a display name above to test this browser-only list.</div>`;
      return;
    }
    target.innerHTML = localData.friends.map((friend, index) => `<div class="simple-row"><div class="message-avatar">${escapeHTML(friend.name.slice(0,1).toUpperCase())}</div><div class="row-copy"><strong>${escapeHTML(friend.name)}</strong><small>Saved on this device</small></div><button type="button" data-remove-friend="${index}">Remove</button></div>`).join("");
  }

  function renderNotifications() {
    const items = localData.notifications || [];
    $("#notification-count").textContent = String(items.length);
    const target = $("#notifications-list");
    if (!items.length) {
      target.innerHTML = `<div class="empty-state">You're all caught up. New local alerts will appear here.</div>`;
      return;
    }
    target.innerHTML = items.map((item) => `<div class="simple-row"><div class="message-avatar">🔔</div><div class="row-copy"><strong>${escapeHTML(item.text)}</strong><small>${escapeHTML(new Date(item.time).toLocaleString())}</small></div></div>`).join("");
  }

  function renderBlocked() {
    const target = $("#blocked-list");
    if (!localData.blocked.length) {
      target.innerHTML = `<div class="empty-state">No blocked names on this device.</div>`;
      return;
    }
    target.innerHTML = localData.blocked.map((name) => `<div class="simple-row"><div class="message-avatar">🚫</div><div class="row-copy"><strong>${escapeHTML(name)}</strong><small>Appwrite User ID · blocked</small></div><button type="button" data-unblock="${escapeHTML(name)}">Unblock</button></div>`).join("");
  }

  function changeView(view) {
    $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
    $$(".view-panel").forEach((panel) => panel.classList.toggle("hidden", panel.id !== `view-${view}`));
    if (view === "public") loadPublicMessages();
  }

  function addFriend(event) {
    event.preventDefault();
    const input = $("#friend-name");
    const name = input.value.trim();
    if (name.length < 2) return;
    if (name.toLowerCase() === displayName().toLowerCase()) return showToast("You can't add yourself.");
    if (localData.friends.some((f) => f.name.toLowerCase() === name.toLowerCase())) return showToast("That name is already on your list.");
    localData.friends.push({ name });
    saveLocalData();
    input.value = "";
    renderFriends();
    addNotification(`Added ${name} to your local friends list.`);
    showToast("Friend added to this browser.");
  }

  function blockName(name) {
    const clean = String(name || "").trim().slice(0, 128);
    if (!clean || clean === currentUser?.$id) return showToast("Enter another member's Appwrite User ID.");
    blockUserId(clean);
  }

  async function submitReport(event) {
    event.preventDefault();
    const userId = $("#report-name").value.trim();
    const reason = $("#report-reason").value;
    const details = $("#report-details").value.trim();
    if (!userId) return showToast("Enter the reported member's Appwrite User ID.");
    if (!reason) return showToast("Choose a report reason.");
    try {
      await callPrivateApi({ action: "report", reportedUserId: userId, reason: `${reason}${details ? `: ${details}` : ""}` });
      $("#report-form").reset();
      addNotification("Your safety report was submitted.");
      showToast("Report submitted. A moderator dashboard still needs to be set up.");
    } catch (error) { showToast(error.message || "Could not submit report."); }
  }

  function saveProfile(event) {
    event.preventDefault();
    profile.name = $("#profile-name-input").value.trim().slice(0, 30) || currentUser?.name || "Friend";
    profile.bio = $("#profile-bio-input").value.trim().slice(0, 120);
    profile.photo = $("#profile-photo-input").value.trim();
    saveLocalData();
    renderProfile();
    $("#profile-dialog").close();
    addNotification("Your profile changes were saved on this device.");
    showToast("Profile saved on this device.");
  }

  function setTheme(dark) {
    document.body.classList.toggle("dark", dark);
    $("#theme-toggle").textContent = dark ? "☀️" : "🌙";
    try { localStorage.setItem("genzTeenChatTheme", dark ? "dark" : "light"); } catch (_) {}
  }

  function bindEvents() {
    $$(".auth-tab").forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode)));
    $("#auth-form").addEventListener("submit", handleAuth);
    $("#signout-button").addEventListener("click", handleSignOut);
    $("#message-form").addEventListener("submit", sendMessage);
    $("#private-open-form").addEventListener("submit", openPrivateConversation);
    $("#private-message-form").addEventListener("submit", sendPrivateMessage);
    $("#private-refresh").addEventListener("click", loadPrivateConversation);
    $("#private-block-user").addEventListener("click", () => {
      if (activePrivateUserId && confirm("Block this member? You will not be able to message each other.")) blockUserId(activePrivateUserId);
    });
    $("#private-report-user").addEventListener("click", () => {
      if (activePrivateUserId) {
        const reason = prompt("Briefly describe the concern (do not include private information):", "Bullying or harassment");
        if (reason && reason.trim()) reportUserId(activePrivateUserId, reason.trim());
      }
    });
    $("#message-input").addEventListener("input", () => $("#char-count").textContent = `${$("#message-input").value.length} / 1000`);
    $("#refresh-chat").addEventListener("click", loadPublicMessages);
    $("#emoji-toggle").addEventListener("click", () => $("#emoji-picker").classList.toggle("hidden"));
    $$("#emoji-picker button").forEach((button) => button.addEventListener("click", () => {
      const input = $("#message-input");
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, start) + button.textContent + input.value.slice(end);
      input.focus();
      input.setSelectionRange(start + button.textContent.length, start + button.textContent.length);
      $("#char-count").textContent = `${input.value.length} / 1000`;
    }));
    $$(".nav-item").forEach((item) => item.addEventListener("click", () => changeView(item.dataset.view)));
    $$("[data-view-jump]").forEach((button) => button.addEventListener("click", () => changeView(button.dataset.viewJump)));
    $("#friend-form").addEventListener("submit", addFriend);
    $("#block-form").addEventListener("submit", (event) => {
      event.preventDefault();
      blockName($("#block-name").value);
      $("#block-form").reset();
    });
    $("#report-form").addEventListener("submit", submitReport);
    $("#clear-notifications").addEventListener("click", () => {
      localData.notifications = [];
      saveLocalData();
      renderNotifications();
      showToast("Local notifications cleared.");
    });
    $("#edit-profile").addEventListener("click", () => {
      $("#profile-name-input").value = profile.name || displayName();
      $("#profile-bio-input").value = profile.bio || "";
      $("#profile-photo-input").value = profile.photo || "";
      $("#profile-dialog").showModal();
    });
    $("#profile-form").addEventListener("submit", saveProfile);
    $("#theme-toggle").addEventListener("click", () => setTheme(!document.body.classList.contains("dark")));
    $("#chat-feed").addEventListener("click", (event) => {
      const react = event.target.closest("[data-react]");
      const report = event.target.closest("[data-report-message]");
      const block = event.target.closest("[data-block-message]");
      const del = event.target.closest("[data-delete-message]");
      if (react) showToast(`You reacted ${react.dataset.react}. Reactions are demo-only for now.`);
      if (report) {
        const userId = report.dataset.reportUserId || "";
        if (userId && userId !== currentUser?.$id) {
          const reason = prompt("Briefly describe the safety concern (do not include private information):", "Bullying or harassment");
          if (reason && reason.trim()) reportUserId(userId, reason.trim());
          else showToast("Report cancelled.");
        } else showToast("This message does not include a valid member ID to report.");
      }
      if (block) {
        const userId = block.dataset.blockUserId || "";
        if (userId) blockUserId(userId); else blockName(block.dataset.blockMessage);
      }
      if (del) deleteMessage(del.dataset.deleteMessage);
    });
    $("#friends-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-friend]");
      if (!button) return;
      localData.friends.splice(Number(button.dataset.removeFriend), 1);
      saveLocalData();
      renderFriends();
    });
    $("#blocked-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-unblock]");
      if (!button) return;
      const id = button.dataset.unblock;
      callPrivateApi({ action: "unblock", blockedId: id }).then(() => {
        localData.blocked = localData.blocked.filter((n) => n.toLowerCase() !== id.toLowerCase());
        saveLocalData(); renderBlocked(); showToast("User unblocked.");
      }).catch((error) => showToast(error.message || "Could not unblock this user."));
    });
  }

  async function init() {
    loadLocalData();
    bindEvents();
    try {
      setTheme(localStorage.getItem("genzTeenChatTheme") === "dark");
    } catch (_) {}
    if (!configured()) {
      setConnectionStatus("Add project details");
      $("#auth-message").textContent = "Before signing in, add your Project ID and Database ID in script.js.";
      return;
    }
    try {
      const user = await account.get();
      showWorkspace(user);
    } catch (_) {
      showAuth();
    }
  }

  init();
})();
