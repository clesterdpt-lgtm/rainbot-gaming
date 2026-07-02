(function () {
  const CATEGORIES = [
    { id: "general", code: "GEN", label: "General", detail: "Site chatter and loose ideas" },
    { id: "game-feedback", code: "FBK", label: "Game Feedback", detail: "What works, what misses" },
    { id: "bug-reports", code: "BUG", label: "Bug Reports", detail: "Broken buttons and cursed saves" },
    { id: "ideas", code: "IDE", label: "Ideas", detail: "New games, modes, and bits" },
    { id: "scores-clips", code: "RUN", label: "Scores / Clips", detail: "Runs, clips, and proof" },
    { id: "announcements", code: "ANN", label: "Announcements", detail: "Drops and backend notices" },
  ];

  const state = {
    category: new URLSearchParams(location.search).get("category") || "",
    replyParentId: null,
    sort: new URLSearchParams(location.search).get("sort") || "hot",
    rendering: false,
  };

  function backendState() {
    if (!window.RBBackend || typeof window.RBBackend.getState !== "function") {
      return { configured: false, ready: false, status: "loading", user: null, profile: null, error: "" };
    }
    return window.RBBackend.getState();
  }

  function clear(node) {
    while (node.firstChild) node.firstChild.remove();
  }

  function textEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  function formatDate(value) {
    const date = new Date(value || 0);
    if (Number.isNaN(date.getTime())) return "Recently";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function authorProfile(row) {
    return row && row.author ? row.author : {};
  }

  function authorName(row) {
    return authorProfile(row).display_name || "Rainbot Player";
  }

  function authorTitle(row) {
    return authorProfile(row).profile_title || "";
  }

  function isOfficialBot(row) {
    return Boolean(authorProfile(row).is_bot);
  }

  function botLabel(row) {
    return String(authorProfile(row).bot_label || "Official Bot").trim().slice(0, 40) || "Official Bot";
  }

  function botBadgeItem(row) {
    return isOfficialBot(row) ? { text: botLabel(row), className: "forum-meta-chip forum-meta-chip--bot" } : null;
  }

  function safeToken(value, fallback) {
    const normalized = String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    return normalized || fallback;
  }

  function profileAvatarAsset(value) {
    if (window.RBProfileAvatars && typeof window.RBProfileAvatars.get === "function") {
      return window.RBProfileAvatars.get(value);
    }
    return null;
  }

  function avatarEl(profileOrName) {
    const profile = typeof profileOrName === "object" && profileOrName ? profileOrName : {};
    const name = profile.display_name || profileOrName || "Rainbot Player";
    const style = safeToken(profile.avatar_style, "bot");
    const accent = safeToken(profile.accent_color, "cyan");
    const asset = profileAvatarAsset(style);
    const avatar = textEl("span", `forum-avatar forum-avatar--${style} forum-avatar--${accent}${asset ? " forum-avatar--image" : ""}`, asset ? "" : String(name || "R").trim().slice(0, 1).toUpperCase() || "R");
    if (asset) {
      const img = document.createElement("img");
      img.src = asset.src;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      avatar.append(img);
    }
    avatar.setAttribute("aria-hidden", "true");
    return avatar;
  }

  function categoryLabel(id) {
    return (CATEGORIES.find((category) => category.id === id) || CATEGORIES[0]).label;
  }

  function categoryCode(id) {
    return (CATEGORIES.find((category) => category.id === id) || CATEGORIES[0]).code;
  }

  function isModerator(currentBackendState = backendState()) {
    const role = currentBackendState && currentBackendState.profile && currentBackendState.profile.role;
    return role === "moderator" || role === "admin";
  }

  function moderationViewActive() {
    return new URLSearchParams(location.search).get("moderation") === "reports";
  }

  function shortBody(value, maxLength = 120) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
  }

  function setStatus(message, kind = "") {
    const status = document.querySelector("[data-community-status]");
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function scrollForumTop() {
    const target = document.querySelector(".forum-layout");
    if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start" });
    else window.scrollTo({ top: 0 });
  }

  function buttonEl(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function metaRow(items) {
    const row = document.createElement("div");
    row.className = "forum-meta-row";
    items.filter(Boolean).forEach((item) => row.append(textEl("span", item.className || "", item.text || item)));
    return row;
  }

  function statEl(value, label) {
    const stat = document.createElement("div");
    stat.className = "forum-stat";
    stat.append(textEl("strong", "", value), textEl("span", "", label));
    return stat;
  }

  function topicScoreRail(topic) {
    const rail = document.createElement("div");
    rail.className = "forum-topic__vote-rail";
    rail.setAttribute("aria-label", `${Number(topic.reply_count) || 0} replies`);
    rail.append(
      textEl("span", "", "▲"),
      textEl("strong", "", String(Number(topic.reply_count) || 0)),
      textEl("span", "", "▼")
    );
    return rail;
  }

  function sortTopics(topics) {
    const list = Array.isArray(topics) ? topics.slice() : [];
    return list.sort((a, b) => {
      if (Boolean(a.is_pinned) !== Boolean(b.is_pinned)) return a.is_pinned ? -1 : 1;
      if (state.sort === "new") return Date.parse(b.created_at || "") - Date.parse(a.created_at || "");
      if (state.sort === "top") return (Number(b.reply_count) || 0) - (Number(a.reply_count) || 0) || Date.parse(b.last_activity_at || "") - Date.parse(a.last_activity_at || "");
      return Date.parse(b.last_activity_at || "") - Date.parse(a.last_activity_at || "") ||
        (Number(b.reply_count) || 0) - (Number(a.reply_count) || 0);
    });
  }

  function buildReplyTree(replies) {
    const nodes = new Map();
    const roots = [];
    (Array.isArray(replies) ? replies : []).forEach((reply) => {
      const id = Number(reply && reply.id);
      if (!Number.isFinite(id) || id <= 0) return;
      const parentId = Number(reply.parent_id);
      nodes.set(id, {
        ...reply,
        id,
        parent_id: Number.isFinite(parentId) && parentId > 0 ? parentId : null,
        children: [],
      });
    });
    nodes.forEach((reply) => {
      const parent = reply.parent_id ? nodes.get(reply.parent_id) : null;
      if (parent && parent.id !== reply.id) parent.children.push(reply);
      else roots.push(reply);
    });
    const sortBranch = (branch) => {
      branch.sort((a, b) => Date.parse(a.created_at || "") - Date.parse(b.created_at || "") || Number(a.id) - Number(b.id));
      branch.forEach((reply) => sortBranch(reply.children));
      return branch;
    };
    return sortBranch(roots);
  }

  function renderFeedControls(root) {
    const controls = document.createElement("div");
    controls.className = "forum-feed-controls";
    const title = document.createElement("div");
    title.className = "forum-feed-controls__title";
    title.append(
      textEl("span", "forum-kicker", state.category ? categoryLabel(state.category) : "r/RainbotNetwork"),
      textEl("h2", "", state.category ? `${categoryLabel(state.category)} Board` : "Community Feed")
    );
    const sorts = document.createElement("div");
    sorts.className = "forum-sort-tabs";
    [
      { value: "hot", label: "Hot" },
      { value: "new", label: "New" },
      { value: "top", label: "Top" },
    ].forEach((sort) => {
      sorts.append(buttonEl(sort.label, "forum-sort-tab" + (state.sort === sort.value ? " is-active" : ""), () => {
        state.sort = sort.value;
        const url = new URL(location.href);
        if (state.sort === "hot") url.searchParams.delete("sort");
        else url.searchParams.set("sort", state.sort);
        if (state.category) url.searchParams.set("category", state.category);
        else url.searchParams.delete("category");
        history.pushState(null, "", url);
        renderCommunity();
      }));
    });
    controls.append(title, sorts);
    root.append(controls);
  }

  function toast(message, kind = "") {
    if (window.RB && typeof window.RB.toast === "function") window.RB.toast(message, kind);
    else setStatus(message, kind);
  }

  function renderCategories() {
    const root = document.querySelector("[data-community-categories]");
    if (!root) return;
    const currentBackendState = backendState();
    clear(root);
    CATEGORIES.forEach((category) => {
      const link = document.createElement("a");
      const url = new URL(location.href);
      url.search = "";
      if (category.id !== "general") url.searchParams.set("category", category.id);
      link.href = url.pathname.split("/").pop() + url.search;
      const isActive = !moderationViewActive() && (state.category === category.id || (!state.category && category.id === "general"));
      link.className = "forum-category" + (isActive ? " is-active" : "");
      link.dataset.category = category.id;
      const code = textEl("span", "forum-category__code", category.code);
      const copy = document.createElement("span");
      copy.className = "forum-category__copy";
      copy.append(textEl("strong", "", category.label), textEl("span", "", category.detail));
      link.append(code, copy);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        state.category = category.id === "general" ? "" : category.id;
        state.replyParentId = null;
        const nextUrl = new URL(location.href);
        nextUrl.search = "";
        if (state.category) nextUrl.searchParams.set("category", state.category);
        history.pushState(null, "", nextUrl);
        scrollForumTop();
        renderCommunity();
      });
      root.append(link);
    });
    if (isModerator(currentBackendState)) {
      const link = document.createElement("a");
      const url = new URL(location.href);
      url.search = "";
      url.searchParams.set("moderation", "reports");
      link.href = url.pathname.split("/").pop() + url.search;
      link.className = "forum-category forum-category--mod" + (moderationViewActive() ? " is-active" : "");
      link.append(
        textEl("span", "forum-category__code", "MOD"),
        (() => {
          const copy = document.createElement("span");
          copy.className = "forum-category__copy";
          copy.append(textEl("strong", "", "Moderation"), textEl("span", "", "Reports and cleanup"));
          return copy;
        })()
      );
      link.addEventListener("click", (event) => {
        event.preventDefault();
        state.replyParentId = null;
        history.pushState(null, "", url);
        scrollForumTop();
        renderCommunity();
      });
      root.append(link);
    }
  }

  function renderSetup(root) {
    clear(root);
    setStatus("Supabase not connected", "warn");
    const card = document.createElement("div");
    card.className = "forum-card forum-card--setup";
    card.append(
      textEl("h2", "", "Backend setup needed"),
      textEl("p", "", "The forum UI is installed. To turn it live, enable Supabase in assets/js/supabase-config.js and run the migration in supabase/migrations."),
      textEl("p", "", "Until then, accounts, profiles, cloud saves, scores, and posts stay in setup mode.")
    );
    root.append(card, renderCategoryPreview());
  }

  function renderCategoryPreview() {
    const wrap = document.createElement("div");
    wrap.className = "forum-preview-grid";
    CATEGORIES.forEach((category) => {
      const card = document.createElement("article");
      card.className = "forum-preview-card";
      card.append(textEl("h3", "", category.label), textEl("p", "", category.detail));
      wrap.append(card);
    });
    return wrap;
  }

  function renderLoginPrompt(root) {
    const prompt = document.createElement("div");
    prompt.className = "forum-card forum-login-card";
    const copy = document.createElement("div");
    copy.className = "forum-login-card__copy";
    copy.append(textEl("span", "forum-kicker", "Read mode"), textEl("h2", "", "Sign in to post"), textEl("p", "", "Browsing is public. Posting, replies, cloud saves, and high scores use your Rainbot account."));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn--primary";
    button.textContent = "Login";
    button.addEventListener("click", () => {
      if (typeof openAuthModal === "function") openAuthModal();
    });
    prompt.append(copy, button);
    root.append(prompt);
  }

  function renderTopicForm(root) {
    const form = document.createElement("form");
    form.className = "forum-form";
    form.innerHTML = `
      <div class="forum-form__header">
        <div>
          <span class="forum-kicker">New thread</span>
          <h2>Start a Topic</h2>
        </div>
        <p>Drop a bug, bit, clip, or idea into the right board.</p>
      </div>
      <div class="forum-form__grid">
        <label class="rb-form-field">
          <span>Board</span>
          <select name="category"></select>
        </label>
        <label class="rb-form-field">
          <span>Title</span>
          <input name="title" type="text" maxlength="110" required />
        </label>
      </div>
      <label class="rb-form-field">
        <span>Post</span>
        <textarea name="body" rows="5" maxlength="6000" required></textarea>
      </label>
      <div class="forum-form__footer">
        <button class="btn btn--primary" type="submit">Post Topic</button>
        <p class="rb-modal-status" data-form-status></p>
      </div>
    `;
    const select = form.elements.category;
    CATEGORIES.forEach((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = category.label;
      option.selected = category.id === (state.category || "general");
      select.append(option);
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector("[data-form-status]");
      const button = form.querySelector("button[type='submit']");
      button.disabled = true;
      status.textContent = "Posting...";
      status.dataset.kind = "";
      try {
        const topic = await window.RBBackend.createTopic({
          category: form.elements.category.value,
          title: form.elements.title.value,
          body: form.elements.body.value,
        });
        const url = new URL(location.href);
        url.search = "";
        url.searchParams.set("topic", topic.id);
        history.pushState(null, "", url);
        scrollForumTop();
        await renderCommunity();
      } catch (error) {
        status.textContent = error.message || "Post failed.";
        status.dataset.kind = "bad";
      } finally {
        button.disabled = false;
      }
    });
    root.append(form);
  }

  function renderBadges(topic) {
    const badges = document.createElement("div");
    badges.className = "forum-badges";
    if (topic.is_pinned) badges.append(textEl("span", "forum-badge forum-badge--pinned", "Pinned"));
    if (topic.is_locked) badges.append(textEl("span", "forum-badge forum-badge--locked", "Locked"));
    if (topic.is_hidden) badges.append(textEl("span", "forum-badge forum-badge--hidden", "Hidden"));
    return badges;
  }

  async function reportItem(type, id) {
    const reason = window.prompt("Reason for report");
    if (reason === null) return;
    try {
      if (type === "topic") await window.RBBackend.reportTopic(id, reason);
      else await window.RBBackend.reportReply(id, reason);
      toast("Report sent", "good");
    } catch (error) {
      toast(error.message || "Report failed.", "bad");
    }
  }

  async function moderateTopic(topic, values) {
    try {
      await window.RBBackend.moderateTopic(topic.id, values);
      toast("Topic updated", "good");
      if (values.is_hidden) {
        const url = new URL(location.href);
        url.search = "";
        history.pushState(null, "", url);
      }
      await renderCommunity();
    } catch (error) {
      toast(error.message || "Moderator action failed.", "bad");
    }
  }

  async function moderateReply(reply, values) {
    try {
      await window.RBBackend.moderateReply(reply.id, values);
      toast("Reply updated", "good");
      await renderCommunity();
    } catch (error) {
      toast(error.message || "Moderator action failed.", "bad");
    }
  }

  function renderTopicActions(topic, currentBackendState) {
    const actions = document.createElement("div");
    actions.className = "forum-actions forum-actions--topic";
    if (currentBackendState.user) {
      actions.append(buttonEl("Report", "forum-action", () => reportItem("topic", topic.id)));
    }
    if (isModerator(currentBackendState)) {
      actions.append(
        buttonEl(topic.is_pinned ? "Unpin" : "Pin", "forum-action forum-action--mod", () => moderateTopic(topic, { is_pinned: !topic.is_pinned })),
        buttonEl(topic.is_locked ? "Unlock" : "Lock", "forum-action forum-action--mod", () => moderateTopic(topic, { is_locked: !topic.is_locked })),
        buttonEl(topic.is_hidden ? "Unhide" : "Hide", "forum-action forum-action--danger", () => moderateTopic(topic, { is_hidden: !topic.is_hidden }))
      );
    }
    return actions;
  }

  function toggleReplyComposer(replyId) {
    const id = Number(replyId);
    if (!Number.isFinite(id) || id <= 0) return;
    state.replyParentId = state.replyParentId === id ? null : id;
    renderCommunity();
  }

  function renderReplyActions(reply, currentBackendState, canReply) {
    const actions = document.createElement("div");
    actions.className = "forum-actions forum-actions--reply";
    if (currentBackendState.user) {
      if (canReply) {
        const isActive = state.replyParentId === Number(reply.id);
        actions.append(buttonEl(isActive ? "Cancel" : "Reply", `forum-action${isActive ? " is-active" : ""}`, () => toggleReplyComposer(reply.id)));
      }
      actions.append(buttonEl("Report", "forum-action", () => reportItem("reply", reply.id)));
    }
    if (isModerator(currentBackendState)) {
      actions.append(buttonEl(reply.is_hidden ? "Unhide" : "Hide", "forum-action forum-action--danger", () => moderateReply(reply, { is_hidden: !reply.is_hidden })));
    }
    return actions;
  }

  function topicCard(topic, currentBackendState) {
    const card = document.createElement("article");
    card.className = "forum-topic" + (topic.is_pinned ? " forum-topic--pinned" : "") + (topic.is_hidden ? " forum-topic--hidden" : "");
    const name = authorName(topic);
    const profileTitle = authorTitle(topic);
    const header = document.createElement("div");
    header.className = "forum-topic__header";
    const identity = document.createElement("div");
    identity.className = "forum-topic__identity";
    identity.append(
      metaRow([
        { text: categoryCode(topic.category), className: "forum-meta-chip" },
        { text: categoryLabel(topic.category) },
        { text: name },
        { text: formatDate(topic.last_activity_at || topic.created_at) },
        botBadgeItem(topic),
        profileTitle ? { text: profileTitle, className: "forum-meta-chip forum-meta-chip--title" } : null,
      ]),
      renderBadges(topic)
    );
    header.append(avatarEl(authorProfile(topic)), identity);
    const title = document.createElement("a");
    title.className = "forum-topic__title";
    title.href = `community.html?topic=${topic.id}`;
    title.textContent = topic.title;
    title.addEventListener("click", (event) => {
      event.preventDefault();
      state.replyParentId = null;
      const url = new URL(location.href);
      url.search = "";
      url.searchParams.set("topic", topic.id);
      history.pushState(null, "", url);
      scrollForumTop();
      renderCommunity();
    });
    const body = textEl("p", "forum-topic__body", topic.body);
    const content = document.createElement("div");
    content.className = "forum-topic__content";
    content.append(header, title, body);
    card.append(topicScoreRail(topic), content, renderTopicActions(topic, currentBackendState));
    return card;
  }

  async function renderTopicList(root, currentBackendState) {
    clear(root);
    setStatus(currentBackendState.user ? "Signed in and ready" : "Read-only until login", currentBackendState.user ? "good" : "");
    if (currentBackendState.user) renderTopicForm(root);
    else renderLoginPrompt(root);
    renderFeedControls(root);

    const list = document.createElement("div");
    list.className = "forum-topic-list";
    root.append(list);

    const topics = await window.RBBackend.listTopics({ category: state.category, limit: 30 });
    if (!topics.length) {
      list.append(textEl("div", "forum-empty", "No posts here yet."));
      return;
    }
    sortTopics(topics).forEach((topic) => list.append(topicCard(topic, currentBackendState)));
  }

  function replyCard(reply, currentBackendState, topic, depth = 0) {
    const replyId = Number(reply.id);
    const safeDepth = Math.max(0, Math.min(8, Number(depth) || 0));
    const canReply = Boolean(currentBackendState.user && topic && !topic.is_locked);
    const card = document.createElement("article");
    card.className = "forum-reply" + (safeDepth ? " forum-reply--child" : "") + (state.replyParentId === replyId ? " forum-reply--replying" : "");
    card.dataset.replyId = String(replyId);
    card.style.setProperty("--reply-depth", String(safeDepth));
    const name = authorName(reply);
    const profileTitle = authorTitle(reply);
    const copy = document.createElement("div");
    copy.className = "forum-reply__content";
    copy.append(
      metaRow([
        { text: name },
        botBadgeItem(reply),
        profileTitle ? { text: profileTitle, className: "forum-meta-chip forum-meta-chip--title" } : null,
        { text: formatDate(reply.created_at) },
      ]),
      textEl("p", "forum-reply__body", reply.body)
    );
    if (canReply && state.replyParentId === replyId) renderReplyForm(copy, topic.id, reply);
    card.append(
      avatarEl(authorProfile(reply)),
      copy,
      renderReplyActions(reply, currentBackendState, canReply)
    );
    return card;
  }

  function appendReplyBranch(root, reply, currentBackendState, topic, depth = 0) {
    root.append(replyCard(reply, currentBackendState, topic, depth));
    (reply.children || []).forEach((child) => appendReplyBranch(root, child, currentBackendState, topic, depth + 1));
  }

  function renderReplyForm(root, topicId, parentReply = null) {
    const parentId = parentReply ? Number(parentReply.id) : null;
    const isNested = Number.isFinite(parentId) && parentId > 0;
    const form = document.createElement("form");
    form.className = `forum-form forum-form--reply${isNested ? " forum-form--reply-inline" : ""}`;
    form.innerHTML = `
      <div class="forum-form__header">
        <div>
          <span class="forum-kicker" data-reply-kicker></span>
          <h2 data-reply-heading></h2>
        </div>
      </div>
      <label class="rb-form-field">
        <span>Message</span>
        <textarea name="body" rows="4" maxlength="6000" required></textarea>
      </label>
      <div class="forum-form__footer">
        <p class="rb-modal-status" data-form-status></p>
        <div class="forum-form__actions">
          ${isNested ? '<button class="btn btn--ghost" type="button" data-cancel-reply>Cancel</button>' : ""}
          <button class="btn btn--primary" type="submit">Post Reply</button>
        </div>
      </div>
    `;
    form.querySelector("[data-reply-kicker]").textContent = isNested ? "Nested reply" : "Thread reply";
    form.querySelector("[data-reply-heading]").textContent = isNested ? `Reply to ${authorName(parentReply)}` : "Reply";
    const cancelButton = form.querySelector("[data-cancel-reply]");
    if (cancelButton) {
      cancelButton.addEventListener("click", () => {
        state.replyParentId = null;
        renderCommunity();
      });
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector("[data-form-status]");
      const button = form.querySelector("button[type='submit']");
      button.disabled = true;
      status.textContent = "Posting...";
      try {
        await window.RBBackend.createReply(topicId, form.elements.body.value, { parentId });
        state.replyParentId = null;
        form.reset();
        await renderCommunity();
      } catch (error) {
        status.textContent = error.message || "Reply failed.";
        status.dataset.kind = "bad";
      } finally {
        button.disabled = false;
      }
    });
    root.append(form);
  }

  async function renderTopic(root, topicId, currentBackendState) {
    clear(root);
    const back = document.createElement("a");
    back.href = "community.html";
    back.className = "forum-back-link";
    back.textContent = "Back to Forum";
    back.addEventListener("click", (event) => {
      event.preventDefault();
      state.replyParentId = null;
      const url = new URL(location.href);
      url.search = "";
      history.pushState(null, "", url);
      scrollForumTop();
      renderCommunity();
    });
    root.append(back);

    const [topic, replies] = await Promise.all([
      window.RBBackend.getTopic(topicId),
      window.RBBackend.listReplies(topicId),
    ]);
    if (!topic) {
      root.append(textEl("div", "forum-empty", "Topic not found."));
      setStatus("Topic unavailable", "bad");
      return;
    }
    setStatus(currentBackendState.user ? "Signed in and ready" : "Read-only until login", currentBackendState.user ? "good" : "");
    const topicFull = document.createElement("article");
    topicFull.className = "forum-topic forum-topic--full";
    const name = authorName(topic);
    const profileTitle = authorTitle(topic);
    const topicMain = document.createElement("div");
    topicMain.className = "forum-topic__content";
    topicMain.append(
      metaRow([
        { text: categoryCode(topic.category), className: "forum-meta-chip" },
        { text: categoryLabel(topic.category) },
        { text: name },
        botBadgeItem(topic),
        profileTitle ? { text: profileTitle, className: "forum-meta-chip forum-meta-chip--title" } : null,
        { text: formatDate(topic.created_at) },
      ]),
      textEl("h2", "forum-topic__heading", topic.title),
      textEl("p", "forum-reply__body", topic.body)
    );
    topicFull.append(topicScoreRail({ reply_count: replies.length }), topicMain, renderBadges(topic), renderTopicActions(topic, currentBackendState));
    root.append(topicFull);
    if (replies.length) {
      const replyList = document.createElement("div");
      replyList.className = "forum-reply-list";
      buildReplyTree(replies).forEach((reply) => appendReplyBranch(replyList, reply, currentBackendState, topic));
      root.append(replyList);
    }
    if (topic.is_locked) root.append(textEl("div", "forum-empty", "This topic is locked."));
    else if (currentBackendState.user) renderReplyForm(root, topicId);
    else renderLoginPrompt(root);
  }

  async function updateReportStatus(report, status) {
    try {
      await window.RBBackend.updateReportStatus(report.id, status);
      toast("Report updated", "good");
      await renderCommunity();
    } catch (error) {
      toast(error.message || "Report update failed.", "bad");
    }
  }

  async function moderateFromReport(report, action) {
    try {
      if (report.topic_id) {
        await window.RBBackend.moderateTopic(report.topic_id, {
          ...action,
          report_id: report.id,
          report_status: "closed",
        });
      } else if (report.reply_id) {
        await window.RBBackend.moderateReply(report.reply_id, {
          ...action,
          report_id: report.id,
          report_status: "closed",
        });
      }
      toast("Moderation applied", "good");
      await renderCommunity();
    } catch (error) {
      toast(error.message || "Moderator action failed.", "bad");
    }
  }

  function reportCard(report) {
    const card = document.createElement("article");
    card.className = `forum-report forum-report--${report.status || "open"}`;
    const target = report.topic
      ? `Topic: ${report.topic.title || `#${report.topic_id}`}`
      : `Reply: ${shortBody(report.reply && report.reply.body ? report.reply.body : `#${report.reply_id}`)}`;
    card.append(
      metaRow([
        { text: report.status || "open", className: "forum-meta-chip" },
        { text: authorName({ author: report.reporter }) },
        { text: formatDate(report.created_at) },
      ]),
      textEl("h3", "forum-report__target", target),
      textEl("p", "forum-reply__body", report.reason)
    );
    const actions = document.createElement("div");
    actions.className = "forum-actions";
    if (report.topic_id) {
      const link = document.createElement("a");
      link.className = "forum-action forum-action--link";
      link.href = `community.html?topic=${report.topic_id}`;
      link.textContent = "Open Topic";
      actions.append(link);
      actions.append(buttonEl("Hide Topic", "forum-action forum-action--danger", () => moderateFromReport(report, { is_hidden: true })));
      actions.append(buttonEl("Lock Topic", "forum-action forum-action--mod", () => moderateFromReport(report, { is_locked: true })));
    } else if (report.reply_id) {
      if (report.reply && report.reply.topic_id) {
        const link = document.createElement("a");
        link.className = "forum-action forum-action--link";
        link.href = `community.html?topic=${report.reply.topic_id}`;
        link.textContent = "Open Topic";
        actions.append(link);
      }
      actions.append(buttonEl("Hide Reply", "forum-action forum-action--danger", () => moderateFromReport(report, { is_hidden: true })));
    }
    if (report.status !== "reviewing") actions.append(buttonEl("Reviewing", "forum-action", () => updateReportStatus(report, "reviewing")));
    if (report.status !== "closed") actions.append(buttonEl("Close", "forum-action", () => updateReportStatus(report, "closed")));
    card.append(actions);
    return card;
  }

  async function renderModeration(root, currentBackendState) {
    clear(root);
    if (!isModerator(currentBackendState)) {
      setStatus("Moderator only", "bad");
      root.append(textEl("div", "forum-empty", "Moderator access required."));
      return;
    }
    setStatus("Moderator tools", "good");
    const header = document.createElement("div");
    header.className = "forum-mod-header";
    const title = document.createElement("div");
    title.append(textEl("span", "forum-kicker", "Moderator queue"), textEl("h2", "", "Reports"));
    header.append(title);
    const status = new URLSearchParams(location.search).get("status") || "open";
    const filters = document.createElement("div");
    filters.className = "forum-actions";
    ["open", "reviewing", "closed", "all"].forEach((value) => {
      filters.append(buttonEl(value, "forum-action" + (status === value ? " is-active" : ""), () => {
        const url = new URL(location.href);
        url.search = "";
        url.searchParams.set("moderation", "reports");
        url.searchParams.set("status", value);
        history.pushState(null, "", url);
        scrollForumTop();
        renderCommunity();
      }));
    });
    header.append(filters);
    root.append(header);
    const reports = await window.RBBackend.listReports({ status, limit: 50 });
    if (!reports.length) {
      root.append(textEl("div", "forum-empty", "No reports here."));
      return;
    }
    reports.forEach((report) => root.append(reportCard(report)));
  }

  async function renderCommunity() {
    if (state.rendering) return;
    state.rendering = true;
    renderCategories();
    const root = document.querySelector("[data-community-root]");
    if (!root) {
      state.rendering = false;
      return;
    }
    const currentBackendState = backendState();
    const topicId = new URLSearchParams(location.search).get("topic");
    if (!topicId || moderationViewActive()) state.replyParentId = null;

    try {
      if (!currentBackendState.configured && currentBackendState.status !== "loading") {
        renderSetup(root);
        return;
      }
      if (currentBackendState.status === "loading") {
        clear(root);
        setStatus("Connecting to Supabase", "");
        root.append(textEl("div", "forum-loading", "Connecting to backend..."));
        return;
      }
      if (currentBackendState.status === "error") {
        clear(root);
        setStatus("Backend error", "bad");
        root.append(textEl("div", "forum-empty", currentBackendState.error || "Backend connection failed."));
        return;
      }
      if (!window.RBBackend || !currentBackendState.ready) {
        renderSetup(root);
        return;
      }
      if (moderationViewActive()) await renderModeration(root, currentBackendState);
      else if (topicId) await renderTopic(root, Number(topicId), currentBackendState);
      else await renderTopicList(root, currentBackendState);
    } catch (error) {
      clear(root);
      setStatus("Forum needs setup", "bad");
      root.append(textEl("div", "forum-empty", error.message || "Forum data could not load. Check the Supabase migration and config."));
    } finally {
      state.rendering = false;
    }
  }

  window.addEventListener("popstate", () => {
    state.category = new URLSearchParams(location.search).get("category") || "";
    state.sort = new URLSearchParams(location.search).get("sort") || "hot";
    renderCommunity();
  });
  window.addEventListener("rainbot:authchange", () => renderCommunity());
  document.addEventListener("DOMContentLoaded", () => renderCommunity());
})();
