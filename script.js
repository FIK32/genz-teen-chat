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
  const PRIVATE_FUNCTION_URL = "https://starter-function-pw9b.nyc.appwrite.run";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const storageKey = "genzTeenChatLocalV1";
  let authMode = "login";
  let currentUser = null;
  let profile = { name: "", bio: "", photo: "", photoFileId: "", usernameColour: "#7657f6", textColour: "#211b3a", accentColour: "#7657f6", appearance: "classic", bubbleMine: "#e8ddff", bubbleOther: "#f0ebff", effects: [] };
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
  const PROFILE_BUCKET_ID = "genz-chat-media";

  function configured() {
    return APPWRITE_PROJECT_ID !== "PASTE_YOUR_PROJECT_ID_HERE" &&
      DATABASE_ID !== "PASTE_YOUR_DATABASE_ID_HERE" &&
      APPWRITE_PROJECT_ID.trim() !== "" && DATABASE_ID.trim() !== "";
  }

  let legacyProfile = {};

  function profileStorageKey(userId) {
    return `genzTeenChatProfileV2:${userId}`;
  }

  function loadLocalData() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || "{}");
      legacyProfile = parsed.profile || {};
      localData = { ...localData, ...(parsed.data || {}) };
    } catch (error) {
      console.warn("Could not load local preferences", error);
    }
  }

  function loadAccountProfile(user) {
    const defaults = {
      name: (user.name || user.email?.split("@")[0] || "Friend").slice(0, 30),
      bio: "", photo: "", photoFileId: "",
      usernameColour: "#7657f6", textColour: "#211b3a",
      accentColour: "#7657f6", appearance: "classic",
      bubbleMine: "#e8ddff", bubbleOther: "#f0ebff", effects: []
    };
    try {
      const saved = localStorage.getItem(profileStorageKey(user.$id));
      if (saved) {
        profile = { ...defaults, ...JSON.parse(saved) };
      } else {
        const migrated = localStorage.getItem("genzTeenChatProfileV2MigrationDone");
        profile = { ...defaults, ...(!migrated ? legacyProfile : {}) };
        localStorage.setItem(profileStorageKey(user.$id), JSON.stringify(profile));
        if (!migrated) localStorage.setItem("genzTeenChatProfileV2MigrationDone", "yes");
      }
    } catch (error) {
      profile = defaults;
      console.warn("Could not load this account's profile preferences", error);
    }
  }

  function saveLocalData() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ data: localData }));
      if (currentUser?.$id) {
        localStorage.setItem(profileStorageKey(currentUser.$id), JSON.stringify(profile));
      } else {
        localStorage.setItem(storageKey, JSON.stringify({ profile, data: localData }));
      }
    } catch (error) {
      console.warn("Could not save local preferences", error);
    }
  }

  async function loadCloudProfile() {
    if (!currentUser) return;
    try {
      const row = await tablesDB.getRow({ databaseId: DATABASE_ID, tableId: "profiles", rowId: currentUser.$id });
      profile.name = row.displayName || profile.name;
      profile.bio = row.bio || "";
      profile.photoFileId = row.avatarFileId || "";
      profile.photo = profile.photoFileId ? fileViewUrl(profile.photoFileId) : "";
      saveLocalData();
      renderProfile();
    } catch (error) {
      console.info("No cloud profile row found yet; keeping this device's profile.", error?.message || "");
    }
  }

  async function saveCloudProfile() {
    if (!currentUser) return;
    const data = {
      userId: currentUser.$id,
      displayName: (profile.name || displayName()).slice(0, 30),
      bio: (profile.bio || "").slice(0, 120),
      ...(profile.photoFileId ? { avatarFileId: profile.photoFileId } : {})
    };
    const permissions = [
      Appwrite.Permission.read(Appwrite.Role.users()),
      Appwrite.Permission.update(Appwrite.Role.user(currentUser.$id)),
      Appwrite.Permission.delete(Appwrite.Role.user(currentUser.$id))
    ];
    try {
      await tablesDB.getRow({ databaseId: DATABASE_ID, tableId: "profiles", rowId: currentUser.$id });
      await tablesDB.updateRow({ databaseId: DATABASE_ID, tableId: "profiles", rowId: currentUser.$id, data });
    } catch (error) {
      if (error?.code !== 404 && !String(error?.message || "").toLowerCase().includes("not found")) throw error;
      await tablesDB.createRow({ databaseId: DATABASE_ID, tableId: "profiles", rowId: currentUser.$id, data, permissions });
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

  function fileViewUrl(fileId) {
    if (!fileId) return "";
    try { return String(storage.getFileView({ bucketId: PROFILE_BUCKET_ID, fileId })); }
    catch (_) { return ""; }
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

  function updateProfilePreview() {
    const preview = $("#profile-preview");
    if (!preview) return;
    preview.style.setProperty("--username-colour", $("#username-colour").value);
    preview.style.setProperty("--profile-text", $("#profile-text-colour").value);
    preview.style.setProperty("--profile-accent", $("#profile-accent").value);
    preview.className = "profile-preview theme-" + $("#profile-appearance").value;
    $$('[data-profile-effect]:checked').forEach(input => preview.classList.add("effect-" + input.dataset.profileEffect));
    preview.style.setProperty("--bubble-mine", $("#profile-bubble-mine").value);
    preview.style.setProperty("--profile-accent", $("#profile-accent").value);
    $("#preview-name").textContent = $("#profile-name-input").value.trim() || "Your username";
    $("#preview-text").textContent = $("#profile-bio-input").value.trim() || "This is your profile preview.";
  }

  function applyProfileStyle() {
    const name = $("#profile-display-name");
    if (name) name.style.color = profile.usernameColour || "";
    const mini = document.querySelector(".profile-mini");
    const themeNames = ["classic","rounded","glass","gradient","neon","pink-paradise","golden-hour","tropical-vibe","galaxy-dream","sakura-bloom","cyber-pulse","sunset-rush","nature-fresh","midnight-luxe","arctic-wave","candy-pop","coffee-mood","cosmic-blue","emerald-glow","bubblegum"];
    if (mini) {
      mini.classList.remove(...themeNames.map(x => "theme-" + x), "effect-animated-background", "effect-glowing-username", "effect-custom-border", "effect-decorative-frame", "effect-moving-gradient");
      mini.classList.add("theme-" + (themeNames.includes(profile.appearance) ? profile.appearance : "classic"));
      (profile.effects || []).forEach(effect => mini.classList.add("effect-" + effect));
      mini.style.setProperty("--profile-accent", profile.accentColour || "#7657f6");
      mini.style.setProperty("--profile-text", profile.textColour || "#211b3a");
      mini.style.setProperty("--username-colour", profile.usernameColour || "#7657f6");
    }
    const avatar = $("#profile-avatar");
    if (avatar) {
      avatar.style.borderColor = profile.accentColour || "";
      avatar.style.borderWidth = "2px";
      avatar.style.borderStyle = "solid";
    }
    document.documentElement.style.setProperty("--bubble-mine", profile.bubbleMine || "#e8ddff");
    document.documentElement.style.setProperty("--bubble-other", profile.bubbleOther || "#f0ebff");
    const feed = $("#chat-feed");
    if (feed) {
      feed.classList.remove("effect-animated-background", "effect-moving-gradient");
      (profile.effects || []).filter(x => ["animated-background", "moving-gradient"].includes(x)).forEach(x => feed.classList.add("effect-" + x));
    }
  }

  function youtubeVideoId(raw) {
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      let id = "";
      if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
      else if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
        if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
        else if (["/embed/", "/shorts/", "/live/"].some(prefix => url.pathname.startsWith(prefix))) id = url.pathname.split("/").filter(Boolean)[1] || "";
      }
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
    } catch (_) { return ""; }
  }

  function messageHtmlWithYoutube(text) {
    const escaped = escapeHTML(text);
    return escaped.replace(/\[\[YOUTUBE:([A-Za-z0-9_-]{11})\]\]/g, (_match, videoId) => {
      const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;
      return `<div class="youtube-embed"><iframe src="${embedUrl}" title="YouTube video shared in public chat" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
    });
  }

  async function heartbeatOnline() {
    if (!currentUser || !configured()) return;
    const now = new Date().toISOString();
    const rowData = { userId: currentUser.$id, displayName: displayName(), lastSeen: now };
    try {
      await tablesDB.updateRow({ databaseId: DATABASE_ID, tableId: "online_users", rowId: currentUser.$id, data: rowData });
    } catch (updateError) {
      try {
        await tablesDB.createRow({ databaseId: DATABASE_ID, tableId: "online_users", rowId: currentUser.$id, data: rowData,
          permissions: [Appwrite.Permission.read(Appwrite.Role.users()), Appwrite.Permission.update(Appwrite.Role.user(currentUser.$id)), Appwrite.Permission.delete(Appwrite.Role.user(currentUser.$id))] });
      } catch (createError) { console.warn("Online presence needs the online_users table and permissions.", createError); }
    }
  }

  async function loadOnlineUsers() {
    const target = $("#online-users-list");
    if (!target || !currentUser) return;
    try {
      const cutoff = new Date(Date.now() - 120000).toISOString();
      const response = await tablesDB.listRows({ databaseId: DATABASE_ID, tableId: "online_users",
        queries: [Appwrite.Query.greaterThan("lastSeen", cutoff), Appwrite.Query.orderDesc("lastSeen"), Appwrite.Query.limit(100)] });
      const users = (response.rows || []).filter(row => row.userId !== currentUser.$id);
      $("#online-count").textContent = String(users.length + 1);
      target.innerHTML = `<div class="simple-row"><strong>🟢 ${escapeHTML(displayName())} (you)</strong><small>Online</small></div>` + (users.length ? users.map(row => `<div class="simple-row"><strong>🟢 ${escapeHTML(row.displayName || "Member")}</strong><small>Online</small></div>`).join("") : `<div class="empty-state">You are the first member online right now.</div>`);
    } catch (error) {
      $("#online-count").textContent = "—";
      target.innerHTML = `<div class="empty-state">Online users are not configured yet. Create the online_users table using README.txt. (${escapeHTML(error.message || "Appwrite error")})</div>`;
    }
  }

  function renderProfile() {
    $("#profile-display-name").textContent = displayName();
    $("#profile-email").textContent = currentUser?.email || "Signed in";
    setAvatar($("#profile-avatar"), displayName(), profile.photo);
    applyProfileStyle();
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
    loadAccountProfile(user);
    $("#auth-screen").classList.add("hidden");
    $("#chat-app").classList.remove("hidden");
    $("#signout-button").classList.remove("hidden");
    renderProfile();
    loadCloudProfile();
    renderFriends();
    renderNotifications();
    renderBlocked();
    setConnectionStatus(configured() ? "Appwrite connected" : "Add project details", configured());
    if (configured()) {
      loadPublicMessages();
      subscribeRealtime();
      heartbeatOnline();
      loadOnlineUsers();
      if (window.genzOnlineTimer) clearInterval(window.genzOnlineTimer);
      window.genzOnlineTimer = setInterval(() => { heartbeatOnline(); if (!$("#view-online").classList.contains("hidden")) loadOnlineUsers(); }, 30000);
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
    if (window.genzOnlineTimer) clearInterval(window.genzOnlineTimer);
    try { await tablesDB.deleteRow({ databaseId: DATABASE_ID, tableId: "online_users", rowId: currentUser.$id }); } catch (_) {}
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
      const avatarUrl = row.avatarFileId ? fileViewUrl(row.avatarFileId) : "";
      return `<article class="chat-message ${mine ? "mine" : "theirs"}" ${mine ? `style="--bubble-mine:${escapeHTML(profile.bubbleMine || "#e8ddff")}"` : ""} data-message-id="${escapeHTML(row.$id || "")}">
        <div class="message-avatar">${avatarUrl ? `<img src="${escapeHTML(avatarUrl)}" alt="${escapeHTML(sender)} profile picture">` : escapeHTML(sender.trim().slice(0,1).toUpperCase() || "G")}</div>
        <div class="message-content">
          <div class="message-meta"><strong>${escapeHTML(sender)}${mine ? " (you)" : ""}</strong><span class="message-time">${escapeHTML(time)}</span></div>
          <p class="message-text">${messageHtmlWithYoutube(text)}</p>
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
          userId: currentUser.$id,
          ...(profile.photoFileId ? { avatarFileId: profile.photoFileId } : {})
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
    if (view === "online") loadOnlineUsers();
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
    profile.name = $("#profile-name-input").value.trim().slice(0, 30) || currentUser?.name || "Friend";
    profile.bio = $("#profile-bio-input").value.trim().slice(0, 120);
    const photoFile = $("#profile-photo-input").files?.[0];
    if (photoFile) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(photoFile.type)) return showToast("Choose a JPG, PNG, WEBP or GIF image.");
      if (photoFile.size > 5 * 1024 * 1024) return showToast("The picture must be 5 MB or smaller.");
      try {
        const uploaded = await storage.createFile({ bucketId: PROFILE_BUCKET_ID, fileId: Appwrite.ID.unique(), file: photoFile });
        profile.photoFileId = uploaded.$id;
        profile.photo = fileViewUrl(uploaded.$id);
      } catch (error) {
        console.error("Profile picture upload failed:", error);
        return showToast("Picture upload failed. Check that the genz-chat-media bucket allows signed-in users to create and read files.");
      }
    }
    profile.usernameColour = $("#username-colour").value;
    profile.textColour = $("#profile-text-colour").value;
    profile.accentColour = $("#profile-accent").value;
    profile.appearance = $("#profile-appearance").value;
    profile.bubbleMine = $("#profile-bubble-mine").value;
    profile.bubbleOther = $("#profile-bubble-other").value;
    profile.effects = $$('[data-profile-effect]:checked').map(input => input.dataset.profileEffect);
    saveLocalData();
    renderProfile();
    $("#profile-dialog").close();
    try {
      await saveCloudProfile();
      saveLocalData();
      renderProfile();
      addNotification("Your profile and picture were saved to your account.");
      showToast("Profile saved to your account.");
    } catch (error) {
      console.error("Cloud profile save failed:", error);
      addNotification("Profile saved on this device; account sync needs Appwrite profiles-table permissions.");
      showToast("Saved on this device, but account sync failed. Check the profiles table permissions.");
    }
  }

  const chatBackgroundThemes = ["original", "aurora", "ocean", "sunset", "lavender", "sakura", "galaxy", "neon-city", "candy", "forest", "beach", "midnight", "pastel", "rainbow", "marble", "pixel"];

  function applyChatBackground(theme) {
    const feed = $("#chat-feed");
    const picker = $("#chat-background-theme");
    if (!feed) return;
    const safeTheme = chatBackgroundThemes.includes(theme) ? theme : "original";
    feed.classList.remove(...chatBackgroundThemes.filter(x => x !== "original").map(x => "chat-bg-" + x));
    if (safeTheme !== "original") feed.classList.add("chat-bg-" + safeTheme);
    if (picker) picker.value = safeTheme;
    try { localStorage.setItem("genzPublicChatBackground", safeTheme); } catch (_) {}
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
    $("#chat-background-theme").addEventListener("change", (event) => applyChatBackground(event.target.value));
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
      $("#profile-photo-preview").textContent = profile.photo ? "Current profile picture is saved." : "Choose a picture to preview it here.";
      $("#username-colour").value = profile.usernameColour || "#7657f6";
      $("#profile-text-colour").value = profile.textColour || "#211b3a";
      $("#profile-accent").value = profile.accentColour || "#7657f6";
      $("#profile-appearance").value = profile.appearance || "classic";
      $("#profile-bubble-mine").value = profile.bubbleMine || "#e8ddff";
      $("#profile-bubble-other").value = profile.bubbleOther || "#f0ebff";
      $$('[data-profile-effect]').forEach(input => { input.checked = (profile.effects || []).includes(input.dataset.profileEffect); });
      updateProfilePreview();
      $("#profile-dialog").showModal();
    });
    $("#profile-photo-input").addEventListener("change", () => {
      const file = $("#profile-photo-input").files?.[0];
      const preview = $("#profile-photo-preview");
      if (!file) { preview.textContent = "Choose a picture to preview it here."; return; }
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 5 * 1024 * 1024) {
        preview.textContent = "Please choose a supported image no larger than 5 MB.";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => { preview.innerHTML = `<img src="${reader.result}" alt="Selected profile picture preview">`; };
      reader.readAsDataURL(file);
    });
    $("#profile-form").addEventListener("submit", saveProfile);
    ["#username-colour", "#profile-text-colour", "#profile-accent", "#profile-appearance", "#profile-name-input", "#profile-bio-input", "#profile-bubble-mine", "#profile-bubble-other"].forEach(selector => $(selector).addEventListener("input", updateProfilePreview));
    $$('[data-profile-effect]').forEach(input => input.addEventListener("change", updateProfilePreview));
    $("#open-youtube").addEventListener("click", () => window.open("https://www.youtube.com/", "_blank", "noopener,noreferrer"));
    $("#share-youtube").addEventListener("click", () => {
      const field = $("#youtube-link");
      const videoId = youtubeVideoId(field.value.trim());
      if (!videoId) return showToast("Paste a valid YouTube video URL first.");
      $("#message-input").value = `🎬 [[YOUTUBE:${videoId}]]`;
      $("#message-form").requestSubmit();
      field.value = "";
    });
    $("#refresh-online").addEventListener("click", loadOnlineUsers);
    $("#theme-toggle").addEventListener("click", () => setTheme(!document.body.classList.contains("dark")));
    document.addEventListener("visibilitychange", () => { if (!document.hidden && currentUser) heartbeatOnline(); });
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
      applyChatBackground(localStorage.getItem("genzPublicChatBackground") || "original");
    } catch (_) { applyChatBackground("original"); }
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