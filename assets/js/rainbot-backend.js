const RBBackend = (() => {
  const SUPABASE_MODULE_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
  const TOPIC_CATEGORIES = new Set([
    "general",
    "game-feedback",
    "bug-reports",
    "ideas",
    "scores-clips",
    "announcements",
  ]);
  const REPORT_STATUSES = new Set(["open", "reviewing", "closed"]);
  const CONTENT_TYPES = new Set(["game", "video", "article"]);
  const PROFILE_AVATARS = new Set([
    "bot",
    "glitch",
    "storm",
    "slime",
    "crown",
    "skull",
    "wizard",
    "ninja",
    "pilot",
    "lava",
    "crystal",
    "joystick",
    "cassette",
    "racer",
    "hacker",
    "comet",
    "moon",
    "cube",
    "flame",
    "trophy",
    "toaster",
    "brain",
    "cereal",
    "panic",
    "confused",
    "lag",
    "hotdog",
    "keycap",
    "dumpster",
    "npc",
    "pizza",
    "fries",
    "pickle",
    "violin",
    "coffee",
    "error404",
    "disco",
    "sock",
    "nosignal",
    "spreadsheet",
    "microwave",
    "banana",
  ]);
  const PROFILE_ACCENTS = new Set(["cyan", "pink", "yellow", "green", "red", "white"]);
  const PROFILE_SELECT = "id, display_name, avatar_url, role, profile_title, bio, favorite_game, avatar_style, accent_color, created_at, updated_at";
  const PROFILE_PUBLIC_SELECT = "display_name, avatar_url, profile_title, avatar_style, accent_color";
  const PROFILE_LOOKUP_SELECT = `id, ${PROFILE_PUBLIC_SELECT}`;

  let client = null;
  let config = {};
  let initPromise = null;
  const listeners = new Set();
  let state = {
    configured: false,
    ready: false,
    status: "disabled",
    user: null,
    profile: null,
    error: "",
    passwordRecovery: false,
  };

  function getState() {
    return { ...state };
  }

  function emit() {
    const snapshot = getState();
    listeners.forEach((listener) => listener(snapshot));
    window.dispatchEvent(new CustomEvent("rainbot:authchange", { detail: snapshot }));
  }

  function setState(patch) {
    state = { ...state, ...patch };
    emit();
  }

  function onChange(listener) {
    listeners.add(listener);
    listener(getState());
    return () => listeners.delete(listener);
  }

  function readConfig() {
    const raw = window.RB_SUPABASE_CONFIG || {};
    const url = String(raw.url || "").trim();
    const anonKey = String(raw.anonKey || "").trim();
    return {
      enabled: Boolean(raw.enabled && url && anonKey),
      url,
      anonKey,
      emailRedirectTo: String(raw.emailRedirectTo || "").trim() || window.location.href,
    };
  }

  function cleanGameId(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9:_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96);
  }

  function cleanText(value, maxLength) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  }

  function cleanEmail(value) {
    return cleanText(value, 254).toLowerCase();
  }

  function cleanPassword(value) {
    return String(value || "");
  }

  function validateEmail(email) {
    if (!email || !email.includes("@")) throw new Error("Enter a valid email.");
    return email;
  }

  function validatePassword(password) {
    if (password.length < 8) throw new Error("Password needs at least 8 characters.");
    return password;
  }

  function cleanBody(value, maxLength) {
    return String(value || "").trim().slice(0, maxLength);
  }

  function cleanReportStatus(value) {
    const normalized = cleanText(value || "open", 20).toLowerCase();
    return REPORT_STATUSES.has(normalized) ? normalized : "open";
  }

  function cleanCategory(value) {
    const normalized = cleanGameId(value || "general");
    return TOPIC_CATEGORIES.has(normalized) ? normalized : "general";
  }

  function cleanContentType(value) {
    const normalized = cleanGameId(value || "");
    if (!CONTENT_TYPES.has(normalized)) throw new Error("Unsupported comment type.");
    return normalized;
  }

  function cleanContentId(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9:_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);
  }

  function cleanCommentSort(value) {
    const normalized = cleanGameId(value || "best");
    return ["best", "new", "top"].includes(normalized) ? normalized : "best";
  }

  function isMissingForumReplyParentColumn(error) {
    const text = `${error && error.message ? error.message : ""} ${error && error.details ? error.details : ""}`;
    return /forum_replies\.parent_id|parent_id.*does not exist|could not find.*parent_id/i.test(text);
  }

  function cleanProfileChoice(value, allowed, fallback) {
    const normalized = cleanGameId(value || fallback);
    return allowed.has(normalized) ? normalized : fallback;
  }

  function displayNameFromUser(user) {
    const meta = user && user.user_metadata ? user.user_metadata : {};
    const name = cleanText(meta.display_name || meta.full_name || meta.name || (user.email || "").split("@")[0] || "Rainbot Player", 32);
    return name.length >= 2 ? name : "Rainbot Player";
  }

  function localSaveToRow(gameId, saved) {
    const savedAt = Number(saved && saved.savedAt) || Date.now();
    return {
      game_id: cleanGameId(gameId),
      version: Number(saved && saved.version) || 1,
      save_data: saved && saved.data && typeof saved.data === "object" ? saved.data : {},
      metadata: saved && saved.meta && typeof saved.meta === "object" ? saved.meta : {},
      local_saved_at: new Date(savedAt).toISOString(),
    };
  }

  function rowToLocalSave(row) {
    if (!row) return null;
    return {
      version: Number(row.version) || 1,
      savedAt: Date.parse(row.local_saved_at || row.updated_at || "") || Date.now(),
      meta: row.metadata || {},
      data: row.save_data || {},
    };
  }

  async function requireClient() {
    await init();
    if (!client) throw new Error("Rainbot backend is not configured yet.");
    return client;
  }

  async function requireUser() {
    const activeClient = await requireClient();
    const { data, error } = await activeClient.auth.getUser();
    if (error) throw error;
    if (!data || !data.user) throw new Error("Sign in to use Rainbot cloud features.");
    if (!state.user || state.user.id !== data.user.id) {
      await hydrateUser(data.user);
    }
    return data.user;
  }

  async function ensureProfile(user) {
    if (!client || !user) return null;
    const { data: existingProfile, error: selectError } = await client
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", user.id)
      .maybeSingle();
    if (selectError) throw selectError;
    if (existingProfile) return existingProfile;

    const fallbackName = displayNameFromUser(user);
    const payload = {
      id: user.id,
      display_name: fallbackName,
      profile_title: "Arcade Regular",
      avatar_style: "bot",
      accent_color: "cyan",
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await client
      .from("profiles")
      .insert(payload)
      .select(PROFILE_SELECT)
      .single();
    if (error) throw error;
    return data;
  }

  async function hydrateUser(user) {
    if (!user) {
      setState({ user: null, profile: null });
      return;
    }
    setState({ user });
    try {
      const profile = await ensureProfile(user);
      setState({ profile, error: "" });
    } catch (error) {
      setState({ profile: null, error: error.message || "Profile load failed." });
      console.warn("[Rainbot] Profile load failed", error);
    }
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      config = readConfig();
      if (!config.enabled) {
        setState({ configured: false, ready: false, status: "disabled", error: "" });
        return getState();
      }

      setState({ configured: true, ready: false, status: "loading", error: "" });
      try {
        const supabase = await import(SUPABASE_MODULE_URL);
        client = supabase.createClient(config.url, config.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        });

        client.auth.onAuthStateChange((event, session) => {
          const isRecovery = event === "PASSWORD_RECOVERY";
          if (event === "SIGNED_OUT") setState({ passwordRecovery: false });
          hydrateUser(session && session.user ? session.user : null).then(() => {
            if (isRecovery) setState({ passwordRecovery: true });
            else if (event === "SIGNED_IN") setState({ passwordRecovery: false });
          });
        });

        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        await hydrateUser(data && data.session ? data.session.user : null);
        setState({ ready: true, status: "ready", error: "" });
      } catch (error) {
        client = null;
        setState({
          configured: true,
          ready: false,
          status: "error",
          error: error.message || "Supabase could not load.",
        });
        console.warn("[Rainbot] Supabase init failed", error);
      }
      return getState();
    })();
    return initPromise;
  }

  async function signInWithMagicLink(email) {
    const activeClient = await requireClient();
    const cleanedEmail = validateEmail(cleanEmail(email));
    const { error } = await activeClient.auth.signInWithOtp({
      email: cleanedEmail,
      options: { emailRedirectTo: config.emailRedirectTo || window.location.href },
    });
    if (error) throw error;
    return true;
  }

  async function signUpWithPassword(email, password) {
    const activeClient = await requireClient();
    const cleanedEmail = validateEmail(cleanEmail(email));
    const cleanedPassword = validatePassword(cleanPassword(password));
    const { data, error } = await activeClient.auth.signUp({
      email: cleanedEmail,
      password: cleanedPassword,
      options: { emailRedirectTo: config.emailRedirectTo || window.location.href },
    });
    if (error) throw error;
    if (data && data.session && data.session.user) await hydrateUser(data.session.user);
    return data;
  }

  async function signInWithPassword(email, password) {
    const activeClient = await requireClient();
    const cleanedEmail = validateEmail(cleanEmail(email));
    const cleanedPassword = validatePassword(cleanPassword(password));
    const { data, error } = await activeClient.auth.signInWithPassword({
      email: cleanedEmail,
      password: cleanedPassword,
    });
    if (error) throw error;
    if (data && data.user) await hydrateUser(data.user);
    return data;
  }

  async function requestPasswordReset(email) {
    const activeClient = await requireClient();
    const cleanedEmail = validateEmail(cleanEmail(email));
    const { error } = await activeClient.auth.resetPasswordForEmail(cleanedEmail, {
      redirectTo: config.emailRedirectTo || window.location.href,
    });
    if (error) throw error;
    return true;
  }

  async function updatePassword(password) {
    const activeClient = await requireClient();
    const cleanedPassword = validatePassword(cleanPassword(password));
    const { data, error } = await activeClient.auth.updateUser({ password: cleanedPassword });
    if (error) throw error;
    setState({ passwordRecovery: false, error: "" });
    if (data && data.user) await hydrateUser(data.user);
    return data;
  }

  async function signInWithGoogle() {
    const activeClient = await requireClient();
    const { data, error } = await activeClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: config.emailRedirectTo || window.location.href },
    });
    if (error) throw error;
    return data;
  }

  const signInWithEmail = signInWithMagicLink;

  async function signOut() {
    const activeClient = await requireClient();
    const { error } = await activeClient.auth.signOut();
    if (error) throw error;
    await hydrateUser(null);
  }

  async function updateProfile(values) {
    const user = await requireUser();
    const displayName = cleanText(values && values.display_name, 32);
    if (displayName.length < 2) throw new Error("Display name needs at least 2 characters.");
    await ensureProfile(user);
    const profileTitle = cleanText((values && values.profile_title) || "Arcade Regular", 40) || "Arcade Regular";
    if (profileTitle.length < 2) throw new Error("Profile title needs at least 2 characters.");
    const payload = {
      display_name: displayName,
      profile_title: profileTitle,
      bio: cleanBody(values && values.bio, 180),
      favorite_game: cleanText(values && values.favorite_game, 80),
      avatar_style: cleanProfileChoice(values && values.avatar_style, PROFILE_AVATARS, "bot"),
      accent_color: cleanProfileChoice(values && values.accent_color, PROFILE_ACCENTS, "cyan"),
      updated_at: new Date().toISOString(),
    };
    if (Object.prototype.hasOwnProperty.call(values || {}, "avatar_url")) {
      const avatarUrl = cleanText(values && values.avatar_url, 300);
      payload.avatar_url = avatarUrl || null;
    }
    const { data, error } = await client
      .from("profiles")
      .update(payload)
      .eq("id", user.id)
      .select(PROFILE_SELECT)
      .single();
    if (error) throw error;
    setState({ profile: data, error: "" });
    return data;
  }

  async function saveGame(gameId, saved) {
    const user = await requireUser();
    const payload = {
      user_id: user.id,
      ...localSaveToRow(gameId, saved),
      updated_at: new Date().toISOString(),
    };
    if (!payload.game_id) throw new Error("Missing game id.");
    const { data, error } = await client
      .from("game_saves")
      .upsert(payload, { onConflict: "user_id,game_id" })
      .select("game_id, version, save_data, metadata, local_saved_at, updated_at")
      .single();
    if (error) throw error;
    return rowToLocalSave(data);
  }

  async function loadGame(gameId) {
    await requireUser();
    const normalizedGameId = cleanGameId(gameId);
    if (!normalizedGameId) return null;
    const { data, error } = await client
      .from("game_saves")
      .select("game_id, version, save_data, metadata, local_saved_at, updated_at")
      .eq("game_id", normalizedGameId)
      .maybeSingle();
    if (error) throw error;
    return rowToLocalSave(data);
  }

  async function deleteGame(gameId) {
    await requireUser();
    const normalizedGameId = cleanGameId(gameId);
    if (!normalizedGameId) return false;
    const { error } = await client.from("game_saves").delete().eq("game_id", normalizedGameId);
    if (error) throw error;
    return true;
  }

  async function recordScore(gameId, score, metadata = {}) {
    await requireUser();
    const normalizedGameId = cleanGameId(gameId);
    const numericScore = Math.max(0, Math.floor(Number(score) || 0));
    if (!normalizedGameId || numericScore <= 0) return null;
    const { data, error } = await client.rpc("record_high_score", {
      p_game_id: normalizedGameId,
      p_score: numericScore,
      p_metadata: metadata && typeof metadata === "object" ? metadata : {},
    });
    if (error) throw error;
    return data;
  }

  async function loadMyScores() {
    const user = await requireUser();
    const { data, error } = await client
      .from("game_scores")
      .select("game_id, score")
      .eq("user_id", user.id);
    if (error) throw error;
    return (data || []).reduce((scores, row) => {
      scores[row.game_id] = Number(row.score) || 0;
      return scores;
    }, {});
  }

  async function attachScoreAuthors(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const userIds = Array.from(new Set(list.map((row) => row.user_id).filter(Boolean)));
    if (!userIds.length) return list.map(({ user_id, ...row }) => ({ ...row, author: {} }));
    const { data, error } = await client
      .from("profiles")
      .select(PROFILE_LOOKUP_SELECT)
      .in("id", userIds);
    if (error) throw error;
    const profilesById = new Map((data || []).map((profile) => [profile.id, profile]));
    return list.map(({ user_id, ...row }) => {
      const profile = profilesById.get(user_id) || {};
      const { id, ...author } = profile;
      return { ...row, author };
    });
  }

  async function listLeaderboard(gameId, limit = 10) {
    await requireClient();
    const normalizedGameId = cleanGameId(gameId);
    if (!normalizedGameId) return [];
    const { data, error } = await client
      .from("game_scores")
      .select("user_id, game_id, score, updated_at")
      .eq("game_id", normalizedGameId)
      .order("score", { ascending: false })
      .limit(Math.max(1, Math.min(50, Number(limit) || 10)));
    if (error) throw error;
    return attachScoreAuthors(data || []);
  }

  async function listGlobalLeaderboard(limit = 20) {
    await requireClient();
    const { data, error } = await client
      .from("game_scores")
      .select("user_id, game_id, score, updated_at")
      .order("score", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(Math.max(1, Math.min(50, Number(limit) || 20)));
    if (error) throw error;
    return attachScoreAuthors(data || []);
  }

  async function listTopics(options = {}) {
    await requireClient();
    const category = options.category ? cleanCategory(options.category) : "";
    let query = client
      .from("forum_topics")
      .select(`id, title, body, category, game_id, reply_count, is_pinned, is_locked, is_hidden, last_activity_at, created_at, author:profiles!forum_topics_author_id_fkey(${PROFILE_PUBLIC_SELECT})`)
      .order("is_pinned", { ascending: false })
      .order("last_activity_at", { ascending: false })
      .limit(Math.max(1, Math.min(50, Number(options.limit) || 30)));
    if (!options.includeHidden) query = query.eq("is_hidden", false);
    if (category) query = query.eq("category", category);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function getTopic(topicId) {
    await requireClient();
    const { data, error } = await client
      .from("forum_topics")
      .select(`id, title, body, category, game_id, reply_count, is_pinned, is_locked, is_hidden, last_activity_at, created_at, author:profiles!forum_topics_author_id_fkey(${PROFILE_PUBLIC_SELECT})`)
      .eq("id", Number(topicId))
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function createTopic(values) {
    const user = await requireUser();
    const title = cleanText(values && values.title, 110);
    const body = cleanBody(values && values.body, 6000);
    if (title.length < 4) throw new Error("Topic title needs at least 4 characters.");
    if (body.length < 4) throw new Error("Topic body needs at least 4 characters.");
    const payload = {
      author_id: user.id,
      title,
      body,
      category: cleanCategory(values && values.category),
      game_id: values && values.game_id ? cleanGameId(values.game_id) : null,
    };
    const { data, error } = await client
      .from("forum_topics")
      .insert(payload)
      .select(`id, title, body, category, game_id, reply_count, is_pinned, is_locked, is_hidden, last_activity_at, created_at, author:profiles!forum_topics_author_id_fkey(${PROFILE_PUBLIC_SELECT})`)
      .single();
    if (error) throw error;
    return data;
  }

  async function listReplies(topicId) {
    await requireClient();
    let { data, error } = await client
      .from("forum_replies")
      .select(`id, parent_id, body, is_hidden, created_at, author:profiles!forum_replies_author_id_fkey(${PROFILE_PUBLIC_SELECT})`)
      .eq("topic_id", Number(topicId))
      .eq("is_hidden", false)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error && isMissingForumReplyParentColumn(error)) {
      const fallback = await client
        .from("forum_replies")
        .select(`id, body, is_hidden, created_at, author:profiles!forum_replies_author_id_fkey(${PROFILE_PUBLIC_SELECT})`)
        .eq("topic_id", Number(topicId))
        .eq("is_hidden", false)
        .order("created_at", { ascending: true })
        .limit(200);
      data = (fallback.data || []).map((reply) => ({ ...reply, parent_id: null }));
      error = fallback.error;
    }
    if (error) throw error;
    return data || [];
  }

  async function createReply(topicId, body, options = {}) {
    const user = await requireUser();
    const cleanedBody = cleanBody(body, 6000);
    const parentId = options && options.parentId ? Number(options.parentId) : null;
    if (cleanedBody.length < 2) throw new Error("Reply needs at least 2 characters.");
    const payload = {
      topic_id: Number(topicId),
      author_id: user.id,
      body: cleanedBody,
    };
    if (Number.isFinite(parentId) && parentId > 0) payload.parent_id = parentId;
    const { data, error } = await client
      .from("forum_replies")
      .insert(payload)
      .select(`id, parent_id, body, is_hidden, created_at, author:profiles!forum_replies_author_id_fkey(${PROFILE_PUBLIC_SELECT})`)
      .single();
    if (error && isMissingForumReplyParentColumn(error)) {
      if (payload.parent_id) throw new Error("Nested replies need the forum nested replies migration.");
      const fallback = await client
        .from("forum_replies")
        .insert({ topic_id: payload.topic_id, author_id: payload.author_id, body: payload.body })
        .select(`id, body, is_hidden, created_at, author:profiles!forum_replies_author_id_fkey(${PROFILE_PUBLIC_SELECT})`)
        .single();
      if (fallback.error) throw fallback.error;
      return { ...fallback.data, parent_id: null };
    }
    if (error) throw error;
    return data;
  }

  async function reportTopic(topicId, reason) {
    const user = await requireUser();
    const cleanedReason = cleanBody(reason, 800);
    if (cleanedReason.length < 4) throw new Error("Report reason needs at least 4 characters.");
    const { data, error } = await client
      .from("forum_reports")
      .insert({ reporter_id: user.id, topic_id: Number(topicId), reason: cleanedReason })
      .select("id, status, created_at")
      .single();
    if (error) throw error;
    return data;
  }

  async function reportReply(replyId, reason) {
    const user = await requireUser();
    const cleanedReason = cleanBody(reason, 800);
    if (cleanedReason.length < 4) throw new Error("Report reason needs at least 4 characters.");
    const { data, error } = await client
      .from("forum_reports")
      .insert({ reporter_id: user.id, reply_id: Number(replyId), reason: cleanedReason })
      .select("id, status, created_at")
      .single();
    if (error) throw error;
    return data;
  }

  async function listReports(options = {}) {
    await requireUser();
    const requestedStatus = cleanText(options.status || "open", 20).toLowerCase();
    const status = requestedStatus === "all" ? "all" : cleanReportStatus(requestedStatus);
    let query = client
      .from("forum_reports")
      .select(`id, reason, status, created_at, topic_id, reply_id, reporter:profiles!forum_reports_reporter_id_fkey(${PROFILE_PUBLIC_SELECT}), topic:forum_topics!forum_reports_topic_id_fkey(id, title, is_hidden, is_locked, is_pinned), reply:forum_replies!forum_reports_reply_id_fkey(id, body, is_hidden, topic_id)`)
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Math.min(100, Number(options.limit) || 50)));
    if (status !== "all") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function updateReportStatus(reportId, status) {
    await requireUser();
    const cleanedStatus = cleanReportStatus(status);
    const { data, error } = await client
      .from("forum_reports")
      .update({ status: cleanedStatus, updated_at: new Date().toISOString() })
      .eq("id", Number(reportId))
      .select("id, status, updated_at")
      .single();
    if (error) throw error;
    return data;
  }

  async function moderateTopic(topicId, values = {}) {
    await requireUser();
    const { data, error } = await client.rpc("moderate_forum_topic", {
      p_topic_id: Number(topicId),
      p_is_hidden: Object.prototype.hasOwnProperty.call(values, "is_hidden") ? Boolean(values.is_hidden) : null,
      p_is_locked: Object.prototype.hasOwnProperty.call(values, "is_locked") ? Boolean(values.is_locked) : null,
      p_is_pinned: Object.prototype.hasOwnProperty.call(values, "is_pinned") ? Boolean(values.is_pinned) : null,
      p_report_id: values.report_id ? Number(values.report_id) : null,
      p_report_status: values.report_status ? cleanReportStatus(values.report_status) : null,
    });
    if (error) throw error;
    return data;
  }

  async function moderateReply(replyId, values = {}) {
    await requireUser();
    const { data, error } = await client.rpc("moderate_forum_reply", {
      p_reply_id: Number(replyId),
      p_is_hidden: Object.prototype.hasOwnProperty.call(values, "is_hidden") ? Boolean(values.is_hidden) : null,
      p_report_id: values.report_id ? Number(values.report_id) : null,
      p_report_status: values.report_status ? cleanReportStatus(values.report_status) : null,
    });
    if (error) throw error;
    return data;
  }

  function sortContentComments(rows, sort) {
    const normalizedSort = cleanCommentSort(sort);
    return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
      if (normalizedSort === "new") {
        return Date.parse(b.created_at || "") - Date.parse(a.created_at || "") || Number(b.id) - Number(a.id);
      }
      if (normalizedSort === "top") {
        return (Number(b.vote_score) || 0) - (Number(a.vote_score) || 0) ||
          Date.parse(b.created_at || "") - Date.parse(a.created_at || "");
      }
      return (Number(b.vote_score) || 0) - (Number(a.vote_score) || 0) ||
        (Number(b.reply_count) || 0) - (Number(a.reply_count) || 0) ||
        Date.parse(b.created_at || "") - Date.parse(a.created_at || "");
    });
  }

  async function attachContentCommentVotes(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const user = state.user;
    if (!user || !list.length) return list.map((row) => ({ ...row, user_vote: 0 }));
    const ids = list.map((row) => row.id).filter(Boolean);
    const { data, error } = await client
      .from("content_comment_votes")
      .select("comment_id, vote")
      .eq("user_id", user.id)
      .in("comment_id", ids);
    if (error) throw error;
    const votesByComment = new Map((data || []).map((vote) => [Number(vote.comment_id), Number(vote.vote) || 0]));
    return list.map((row) => ({ ...row, user_vote: votesByComment.get(Number(row.id)) || 0 }));
  }

  async function listContentComments(options = {}) {
    await requireClient();
    const contentType = cleanContentType(options.contentType);
    const contentId = cleanContentId(options.contentId);
    if (!contentId) throw new Error("Missing comment target.");
    const { data, error } = await client
      .from("content_comments")
      .select(`id, parent_id, content_type, content_id, page_url, page_title, body, vote_score, reply_count, is_hidden, created_at, updated_at, author:profiles!content_comments_author_id_fkey(${PROFILE_PUBLIC_SELECT})`)
      .eq("content_type", contentType)
      .eq("content_id", contentId)
      .eq("is_hidden", false)
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Math.min(200, Number(options.limit) || 120)));
    if (error) throw error;
    return sortContentComments(await attachContentCommentVotes(data || []), options.sort);
  }

  async function createContentComment(values = {}) {
    const user = await requireUser();
    const contentType = cleanContentType(values.contentType);
    const contentId = cleanContentId(values.contentId);
    const body = cleanBody(values.body, 6000);
    const pageTitle = cleanText(values.pageTitle || "Rainbot", 140);
    const pageUrl = cleanText(values.pageUrl || window.location.pathname, 300);
    const parentId = values.parentId ? Number(values.parentId) : null;
    if (!contentId) throw new Error("Missing comment target.");
    if (pageTitle.length < 2) throw new Error("Missing page title.");
    if (body.length < 2) throw new Error("Comment needs at least 2 characters.");
    const payload = {
      parent_id: Number.isFinite(parentId) && parentId > 0 ? parentId : null,
      author_id: user.id,
      content_type: contentType,
      content_id: contentId,
      page_url: pageUrl,
      page_title: pageTitle,
      body,
    };
    const { data, error } = await client
      .from("content_comments")
      .insert(payload)
      .select(`id, parent_id, content_type, content_id, page_url, page_title, body, vote_score, reply_count, is_hidden, created_at, updated_at, author:profiles!content_comments_author_id_fkey(${PROFILE_PUBLIC_SELECT})`)
      .single();
    if (error) throw error;
    return { ...data, user_vote: 0 };
  }

  async function voteContentComment(commentId, vote) {
    const user = await requireUser();
    const id = Number(commentId);
    const numericVote = Number(vote);
    if (!Number.isFinite(id) || id <= 0) throw new Error("Missing comment id.");
    if (![1, 0, -1].includes(numericVote)) throw new Error("Invalid vote.");
    if (numericVote === 0) {
      const { error } = await client
        .from("content_comment_votes")
        .delete()
        .eq("comment_id", id)
        .eq("user_id", user.id);
      if (error) throw error;
      return { comment_id: id, vote: 0 };
    }
    const { data, error } = await client
      .from("content_comment_votes")
      .upsert({ comment_id: id, user_id: user.id, vote: numericVote }, { onConflict: "comment_id,user_id" })
      .select("comment_id, vote")
      .single();
    if (error) throw error;
    return data;
  }

  return {
    init,
    onChange,
    getState,
    signInWithEmail,
    signInWithMagicLink,
    signUpWithPassword,
    signInWithPassword,
    requestPasswordReset,
    updatePassword,
    signInWithGoogle,
    signOut,
    updateProfile,
    saveGame,
    loadGame,
    deleteGame,
    recordScore,
    loadMyScores,
    listLeaderboard,
    listGlobalLeaderboard,
    listTopics,
    getTopic,
    createTopic,
    listReplies,
    createReply,
    reportTopic,
    reportReply,
    listReports,
    updateReportStatus,
    moderateTopic,
    moderateReply,
    listContentComments,
    createContentComment,
    voteContentComment,
  };
})();

window.RBBackend = RBBackend;
