(function () {
  const CATEGORIES = [
    { id: "general", label: "General", detail: "Site chatter and loose ideas" },
    { id: "game-feedback", label: "Game Feedback", detail: "What works, what misses" },
    { id: "bug-reports", label: "Bug Reports", detail: "Broken buttons and cursed saves" },
    { id: "ideas", label: "Ideas", detail: "New games, modes, and bits" },
    { id: "scores-clips", label: "Scores / Clips", detail: "Runs, clips, and proof" },
    { id: "announcements", label: "Announcements", detail: "Drops and backend notices" },
  ];

  const state = {
    category: new URLSearchParams(location.search).get("category") || "",
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

  function authorName(row) {
    return (row && row.author && row.author.display_name) || "Rainbot Player";
  }

  function categoryLabel(id) {
    return (CATEGORIES.find((category) => category.id === id) || CATEGORIES[0]).label;
  }

  function setStatus(message, kind = "") {
    const status = document.querySelector("[data-community-status]");
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function renderCategories() {
    const root = document.querySelector("[data-community-categories]");
    if (!root) return;
    clear(root);
    CATEGORIES.forEach((category) => {
      const link = document.createElement("a");
      const url = new URL(location.href);
      url.search = "";
      if (category.id !== "general") url.searchParams.set("category", category.id);
      link.href = url.pathname.split("/").pop() + url.search;
      link.className = "forum-category" + (state.category === category.id || (!state.category && category.id === "general") ? " is-active" : "");
      link.dataset.category = category.id;
      const strong = textEl("strong", "", category.label);
      const span = textEl("span", "", category.detail);
      link.append(strong, span);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        state.category = category.id === "general" ? "" : category.id;
        const nextUrl = new URL(location.href);
        nextUrl.search = "";
        if (state.category) nextUrl.searchParams.set("category", state.category);
        history.pushState(null, "", nextUrl);
        renderCommunity();
      });
      root.append(link);
    });
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
    prompt.append(textEl("h2", "", "Sign in to post"));
    prompt.append(textEl("p", "", "Browsing is public. Posting, replies, cloud saves, and high scores use your Rainbot account."));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn--primary";
    button.textContent = "Login";
    button.addEventListener("click", () => {
      if (typeof openAuthModal === "function") openAuthModal();
    });
    prompt.append(button);
    root.append(prompt);
  }

  function renderTopicForm(root) {
    const form = document.createElement("form");
    form.className = "forum-form";
    form.innerHTML = `
      <h2>Start a Topic</h2>
      <label class="rb-form-field">
        <span>Board</span>
        <select name="category"></select>
      </label>
      <label class="rb-form-field">
        <span>Title</span>
        <input name="title" type="text" maxlength="110" required />
      </label>
      <label class="rb-form-field">
        <span>Post</span>
        <textarea name="body" rows="5" maxlength="6000" required></textarea>
      </label>
      <button class="btn btn--primary" type="submit">Post Topic</button>
      <p class="rb-modal-status" data-form-status></p>
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

  function topicCard(topic) {
    const card = document.createElement("article");
    card.className = "forum-topic";
    const meta = textEl("div", "forum-topic__meta", `${categoryLabel(topic.category)} / ${authorName(topic)} / ${formatDate(topic.last_activity_at || topic.created_at)}`);
    const title = document.createElement("a");
    title.className = "forum-topic__title";
    title.href = `community.html?topic=${topic.id}`;
    title.textContent = topic.title;
    title.addEventListener("click", (event) => {
      event.preventDefault();
      const url = new URL(location.href);
      url.search = "";
      url.searchParams.set("topic", topic.id);
      history.pushState(null, "", url);
      renderCommunity();
    });
    const body = textEl("p", "forum-topic__body", topic.body);
    const foot = textEl("div", "forum-topic__foot", `${Number(topic.reply_count) || 0} replies`);
    card.append(meta, title, body, foot);
    return card;
  }

  async function renderTopicList(root, currentBackendState) {
    clear(root);
    setStatus(currentBackendState.user ? "Signed in and ready" : "Read-only until login", currentBackendState.user ? "good" : "");
    if (currentBackendState.user) renderTopicForm(root);
    else renderLoginPrompt(root);

    const list = document.createElement("div");
    list.className = "forum-topic-list";
    root.append(list);

    const topics = await window.RBBackend.listTopics({ category: state.category, limit: 30 });
    if (!topics.length) {
      list.append(textEl("div", "forum-empty", "No posts here yet."));
      return;
    }
    topics.forEach((topic) => list.append(topicCard(topic)));
  }

  function replyCard(reply) {
    const card = document.createElement("article");
    card.className = "forum-reply";
    card.append(
      textEl("div", "forum-topic__meta", `${authorName(reply)} / ${formatDate(reply.created_at)}`),
      textEl("p", "forum-reply__body", reply.body)
    );
    return card;
  }

  function renderReplyForm(root, topicId) {
    const form = document.createElement("form");
    form.className = "forum-form forum-form--reply";
    form.innerHTML = `
      <h2>Reply</h2>
      <label class="rb-form-field">
        <span>Message</span>
        <textarea name="body" rows="4" maxlength="6000" required></textarea>
      </label>
      <button class="btn btn--primary" type="submit">Post Reply</button>
      <p class="rb-modal-status" data-form-status></p>
    `;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector("[data-form-status]");
      const button = form.querySelector("button[type='submit']");
      button.disabled = true;
      status.textContent = "Posting...";
      try {
        await window.RBBackend.createReply(topicId, form.elements.body.value);
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
      const url = new URL(location.href);
      url.search = "";
      history.pushState(null, "", url);
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
    topicFull.append(
      textEl("div", "forum-topic__meta", `${categoryLabel(topic.category)} / ${authorName(topic)} / ${formatDate(topic.created_at)}`),
      textEl("h2", "forum-topic__heading", topic.title),
      textEl("p", "forum-reply__body", topic.body),
      textEl("div", "forum-topic__foot", `${replies.length} replies`)
    );
    root.append(topicFull);
    replies.forEach((reply) => root.append(replyCard(reply)));
    if (currentBackendState.user) renderReplyForm(root, topicId);
    else renderLoginPrompt(root);
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
      if (topicId) await renderTopic(root, Number(topicId), currentBackendState);
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
    renderCommunity();
  });
  window.addEventListener("rainbot:authchange", () => renderCommunity());
  document.addEventListener("DOMContentLoaded", () => renderCommunity());
})();
