/* GENZ TEEN CHAT
   Appwrite-backed: account signup/sign-in and public messages.
   Browser-only starter features: profile preferences, friends, notifications,
   block list, and report log. These are NOT shared between accounts/devices yet.
   Never add an Appwrite API key to browser code.
*/
(() => {
  "use strict";

  // 1) Replace these values with your own Appwrite project details.
 
  // Appwrite project configuration
  const APPWRITE_ENDPOINT = "https://nyc.cloud.appwrite.io/v1";
  const APPWRITE_PROJECT_ID = "6ada4252003150fd4cdd";
  const DATABASE_ID = "genz-chat-db";
  const MESSAGES_TABLE_ID = "messages";
  const PROFILES_TABLE_ID = "profiles";
  const MEDIA_BUCKET_ID = "genz-chat-media";
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
  const storage = new Appwrite.Storage(client);
  let myProfileRow = null;
  let onlineRefreshTimer = null;
  let profileRealtimeUnsubscribe = null;

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

  const COUNTRY_OPTIONS = [
    ["UG", "🇺🇬 Uganda"], ["KE", "🇰🇪 Kenya"], ["TZ", "🇹🇿 Tanzania"], ["RW", "🇷🇼 Rwanda"],
    ["BI", "🇧🇮 Burundi"], ["SS", "🇸🇸 South Sudan"], ["NG", "🇳🇬 Nigeria"], ["GH", "🇬🇭 Ghana"],
    ["ZA", "🇿🇦 South Africa"], ["US", "🇺🇸 United States"], ["GB", "🇬🇧 United Kingdom"], ["OTHER", "🌍 Other"]
  ];
  function countryLabel(code) { return COUNTRY_OPTIONS.find(([key]) => key === code)?.[1] || "🌍"; }
  function fileView(fileId) {
    if (!fileId) return "";
    try { return storage.getFileView({ bucketId: MEDIA_BUCKET_ID, fileId }).toString(); }
    catch (_) { return ""; }
  }
  async function uploadMedia(file, purpose) {
    if (!file) return "";
    const imageOK = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type);
    const videoOK = ["video/mp4", "video/webm"].includes(file.type);
    if (purpose === "avatar" && !imageOK) throw new Error("Choose a JPG, PNG, GIF or WEBP picture.");
    if (purpose === "message" && !imageOK && !videoOK) throw new Error("Choose an image or MP4/WEBM video.");
    const limit = purpose === "avatar" ? 5 : 25;
    if (file.size > limit * 1024 * 1024) throw new Error(`File must be ${limit} MB or smaller.`);
    const permissions = [
      Appwrite.Permission.read(Appwrite.Role.users()),
      Appwrite.Permission.update(Appwrite.Role.user(currentUser.$id)),
      Appwrite.Permission.delete(Appwrite.Role.user(currentUser.$id))
    ];
    const uploaded = await storage.createFile({ bucketId: MEDIA_BUCKET_ID, fileId: Appwrite.ID.unique(), file, permissions });
    return uploaded.$id;
  }
  async function loadMyProfile() {
    if (!currentUser) return;
    try {
      myProfileRow = await tablesDB.getRow({ databaseId: DATABASE_ID, tableId: PROFILES_TABLE_ID, rowId: currentUser.$id });
      profile.name = myProfileRow.displayName || profile.name || currentUser.name;
      profile.bio = myProfileRow.bio || "";
      profile.countryCode = myProfileRow.countryCode || "UG";
      profile.avatarFileId = myProfileRow.avatarFileId || "";
      profile.photo = fileView(profile.avatarFileId);
      saveLocalData(); renderProfile();
    } catch (error) {
      if (error.code !== 404) console.warn("Profile could not be loaded; a new one will be created when saved.", error);
    }
  }
  async function saveProfileToCloud() {
    if (!currentUser) return;
    const data = {
      userId: currentUser.$id,
      displayName: profile.name,
      bio: profile.bio,
      countryCode: profile.countryCode || "UG",
      avatarFileId: profile.avatarFileId || "",
      lastSeen: new Date().toISOString()
    };
    const permissions = [
      Appwrite.Permission.read(Appwrite.Role.users()),
      Appwrite.Permission.update(Appwrite.Role.user(currentUser.$id)),
      Appwrite.Permission.delete(Appwrite.Role.user(currentUser.$id))
    ];
    if (myProfileRow) {
      myProfileRow = await tablesDB.updateRow({ databaseId: DATABASE_ID, tableId: PROFILES_TABLE_ID, rowId: currentUser.$id, data });
    } else {
      myProfileRow = await tablesDB.createRow({ databaseId: DATABASE_ID, tableId: PROFILES_TABLE_ID, rowId: currentUser.$id, data, permissions });
    }
  }
  async function updatePresence() {
    if (!currentUser || !myProfileRow) return;
    try {
      myProfileRow = await tablesDB.updateRow({ databaseId: DATABASE_ID, tableId: PROFILES_TABLE_ID, rowId: currentUser.$id, data: { lastSeen: new Date().toISOString() } });
      await loadOnlineUsers();
    } catch (error) { console.warn("Presence update failed", error); }
  }
  async function loadOnlineUsers() {
    const target = document.querySelector("#online-users-list");
    const count = document.querySelector("#online-count");
    if (!target || !count || !currentUser) return;
    try {
      const response = await tablesDB.listRows({ databaseId: DATABASE_ID, tableId: PROFILES_TABLE_ID,
        queries: [Appwrite.Query.orderDesc("lastSeen"), Appwrite.Query.limit(100)] });
      const cutoff = Date.now() - 90000;
      const online = (response.rows || []).filter(row => row.lastSeen && new Date(row.lastSeen).getTime() > cutoff);
      count.textContent = String(online.length);
      target.innerHTML = online.map(row => { const avatar = fileView(row.avatarFileId); return `<div class="online-user-row"><span class="online-indicator"></span>${avatar ? `<img class="online-avatar" src="${escapeHTML(avatar)}" alt="">` : `<span class="online-avatar-fallback">${escapeHTML((row.displayName || "M").slice(0,1).toUpperCase())}</span>`}<strong>${escapeHTML(row.displayName || "Member")}</strong><span>${escapeHTML(countryLabel(row.countryCode))}</span></div>`; }).join("") || `<p class="muted">No one else is online right now.</p>`;
    } catch (error) { target.innerHTML = `<p class="muted">Online list unavailable. Check profiles table read permissions.</p>`; }
  }
  function installOnlinePanel() {
    const footer = document.querySelector(".sidebar-bottom");
    if (!footer || document.querySelector("#online-users-button")) return;
    footer.innerHTML = `<button id="online-users-button" class="online-users-button" type="button"><span class="online-dot"></span> Online now: <strong id="online-count">0</strong></button>`;
    const panel = document.createElement("section");
    panel.id = "online-users-panel"; panel.className = "online-users-panel hidden";
    panel.innerHTML = `<div class="online-panel-heading"><strong>Online members</strong><button id="online-users-close" type="button" aria-label="Close">✕</button></div><div id="online-users-list"></div>`;
    document.body.appendChild(panel);
    document.querySelector("#online-users-button").addEventListener("click", () => { panel.classList.toggle("hidden"); loadOnlineUsers(); });
    document.querySelector("#online-users-close").addEventListener("click", () => panel.classList.add("hidden"));
  }
  function addThemePicker() {
    if (document.querySelector("#theme-picker")) return;
    const select = document.createElement("select"); select.id = "theme-picker"; select.setAttribute("aria-label", "Choose chat theme");
    select.innerHTML = `<option value="lavender">Lavender</option><option value="ocean">Ocean</option><option value="sunset">Sunset</option><option value="nature">Nature</option><option value="neon">Neon Night</option>`;
    select.value = localStorage.getItem("genzTeenChatThemeMode") || "lavender";
    document.querySelector(".top-actions")?.insertBefore(select, document.querySelector("#theme-toggle"));
    select.addEventListener("change", () => setTheme(localStorage.getItem("genzTeenChatThemeMode") === "dark", select.value));
  }
  function addMediaControls() {
    const form = document.querySelector("#message-form");
    if (!form || document.querySelector("#message-media-input")) return;
    const messageTextInput = form.querySelector("#message-input"); if (messageTextInput) messageTextInput.required = false;
    const media = document.createElement("input"); media.type = "file"; media.id = "message-media-input"; media.accept = "image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm"; media.hidden = true;
    const choose = document.createElement("button"); choose.type = "button"; choose.className = "icon-button"; choose.textContent = "📎"; choose.title = "Attach an image or video";
    const youtube = document.createElement("button"); youtube.type = "button"; youtube.className = "icon-button"; youtube.textContent = "▶️"; youtube.title = "Open YouTube";
    choose.addEventListener("click", () => media.click());
    media.addEventListener("change", () => { const f = media.files?.[0]; if (f) showToast(`Ready to share: ${f.name}`); });
    youtube.addEventListener("click", () => window.open("https://www.youtube.com/", "_blank", "noopener,noreferrer"));
    form.insertBefore(choose, form.querySelector("input")); form.insertBefore(youtube, form.querySelector("input")); form.appendChild(media);
  }
  function renderMessageBody(text, fileId, mediaType) {
    let mediaHTML = "";
    const url = fileView(fileId);
    if (url && mediaType === "image") mediaHTML = `<img class="shared-media" src="${escapeHTML(url)}" alt="Shared image" loading="lazy">`;
    if (url && mediaType === "video") mediaHTML = `<video class="shared-media" controls preload="metadata"><source src="${escapeHTML(url)}"></video>`;
    const safeText = escapeHTML(text);
    const yt = String(text || "").match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    const youtubeHTML = yt ? `<iframe class="youtube-embed" src="https://www.youtube-nocookie.com/embed/${yt[1]}" title="YouTube video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>` : "";
    return `${safeText}${mediaHTML}${youtubeHTML}`;
  }
  function renderProfile() {
    $("#profile-display-name").textContent = displayName();
    $("#profile-email").textContent = currentUser?.email || "Signed in";
    setAvatar($("#profile-avatar"), displayName(), profile.photo);
    const country = document.querySelector("#profile-country-label"); if (country) country.textContent = countryLabel(profile.countryCode || "UG");
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
    installOnlinePanel(); addThemePicker(); addMediaControls();
    loadMyProfile().then(() => { saveProfileToCloud().catch(err => console.warn("Profile setup:", err)); updatePresence(); });
    if (onlineRefreshTimer) clearInterval(onlineRefreshTimer);
    onlineRefreshTimer = setInterval(updatePresence, 30000);
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
    if (onlineRefreshTimer) { clearInterval(onlineRefreshTimer); onlineRefreshTimer = null; }
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
    if (!visibleRows.length) { feed.innerHTML = `<div class="empty-state">No messages yet. Be the first to say hello! 👋</div>`; return; }
    feed.innerHTML = visibleRows.map((row) => {
      const sender = String(row.senderName || "Community member");
      const date = row.$createdAt ? new Date(row.$createdAt) : null;
      const time = date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
      const mine = currentUser && row.userId === currentUser.$id;
      const avatarUrl = fileView(row.avatarFileId);
      const avatar = avatarUrl ? `<img src="${escapeHTML(avatarUrl)}" alt="">` : escapeHTML(sender.trim().slice(0,1).toUpperCase() || "G");
      return `<article class="chat-message ${mine ? "mine" : "theirs"}" data-message-id="${escapeHTML(row.$id || "")}">
        <div class="message-avatar">${avatar}</div><div class="message-content">
          <div class="message-meta"><strong>${escapeHTML(sender)}${mine ? " (you)" : ""}</strong><span class="country-flag">${escapeHTML(countryLabel(row.countryCode || ""))}</span><span class="message-time">${escapeHTML(time)}</span></div>
          <div class="message-text">${renderMessageBody(row.messageText || "", row.mediaFileId, row.mediaType)}</div>
          <div class="message-tools"><button type="button" data-react="💙">💙 React</button><button type="button" data-react="😂">😂 React</button><button type="button" data-report-message="${escapeHTML(sender)}" data-report-user-id="${escapeHTML(row.userId || "")}">🚩 Report</button>
          ${mine ? `<button type="button" data-delete-message="${escapeHTML(row.$id || "")}">Delete</button>` : `<button type="button" data-block-message="${escapeHTML(sender)}" data-block-user-id="${escapeHTML(row.userId || "")}">Block</button>`}</div>
        </div></article>`;
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
    const fileInput = $("#message-media-input");
    const file = fileInput?.files?.[0] || null;
    if (!messageText && !file) return;
    if (!currentUser) return showToast("Sign in before sending a message.");
    if (messageText.length > 1000) return showToast("Messages must be 1000 characters or fewer.");
    const button = $("#message-form button[type='submit']"); button.disabled = true;
    try {
      let mediaFileId = ""; let mediaType = "";
      if (file) { mediaFileId = await uploadMedia(file, "message"); mediaType = file.type.startsWith("image/") ? "image" : "video"; }
      await tablesDB.createRow({ databaseId: DATABASE_ID, tableId: MESSAGES_TABLE_ID, rowId: Appwrite.ID.unique(), data: {
        senderName: displayName(), messageText: messageText || (mediaType === "image" ? "Shared a photo" : "Shared a video"),
        userId: currentUser.$id, countryCode: profile.countryCode || "UG", avatarFileId: profile.avatarFileId || "",
        mediaFileId, mediaType
      }});
      input.value = ""; if (fileInput) fileInput.value = "";
      $("#char-count").textContent = "0 / 1000"; $("#emoji-picker").classList.add("hidden"); await loadPublicMessages();
    } catch (error) { console.error("Could not send message:", error); showToast(`Message not sent: ${error.message || "check Appwrite permissions"}`); }
    finally { button.disabled = false; input.focus(); }
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

  async function saveProfile(event) {
    event.preventDefault();
    const saveButton = $("#profile-form button[type='submit']"); saveButton.disabled = true;
    try {
      profile.name = $("#profile-name-input").value.trim().slice(0, 30) || currentUser?.name || "Friend";
      profile.bio = $("#profile-bio-input").value.trim().slice(0, 120);
      profile.countryCode = $("#profile-country-input").value || "UG";
      const photoFile = $("#profile-avatar-file")?.files?.[0];
      if (photoFile) profile.avatarFileId = await uploadMedia(photoFile, "avatar");
      profile.photo = fileView(profile.avatarFileId);
      await saveProfileToCloud(); saveLocalData(); renderProfile();
      $("#profile-dialog").close(); addNotification("Your profile was saved to your account."); showToast("Profile saved.");
    } catch (error) { showToast(`Profile not saved: ${error.message || "check profiles permissions"}`); }
    finally { saveButton.disabled = false; }
  }
  function setTheme(dark, theme = localStorage.getItem("genzTeenChatThemeMode") || "lavender") {
    const themes = ["lavender", "ocean", "sunset", "nature", "neon"];
    if (!themes.includes(theme)) theme = "lavender";
    document.body.classList.remove("dark", ...themes.map(t => `theme-${t}`));
    document.body.classList.add(`theme-${theme}`); document.body.classList.toggle("dark", !!dark);
    $("#theme-toggle").textContent = dark ? "☀️" : "🌙";
    const picker = document.querySelector("#theme-picker"); if (picker) picker.value = theme;
    try { localStorage.setItem("genzTeenChatTheme", dark ? "dark" : "light"); localStorage.setItem("genzTeenChatThemeMode", theme); } catch (_) {}
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
      $("#profile-photo-input").value = "";
      $("#profile-country-input").value = profile.countryCode || "UG";
      const avatarInput = $("#profile-avatar-file"); if (avatarInput) avatarInput.value = "";
      const preview = $("#profile-avatar-preview"); if (preview) preview.innerHTML = profile.photo ? `<img src="${escapeHTML(profile.photo)}" alt="Current profile picture">` : "No picture selected";
      $("#profile-dialog").showModal();
    });
    $("#profile-form").addEventListener("submit", saveProfile);
    $("#profile-avatar-file").addEventListener("change", () => { const f = $("#profile-avatar-file").files?.[0]; const preview = $("#profile-avatar-preview"); if (!preview) return; if (!f) { preview.textContent = "No picture selected"; return; } if (!f.type.startsWith("image/")) { preview.textContent = "Choose an image file"; return; } const url = URL.createObjectURL(f); preview.innerHTML = `<img src="${url}" alt="Profile picture preview">`; });
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
      setTheme(localStorage.getItem("genzTeenChatTheme") === "dark", localStorage.getItem("genzTeenChatThemeMode") || "lavender");
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