const ADMIN_ROLE = "admin";
const USER_ROLE = "user";

let authMode = "login";

const AUTH_TEXT_LIMIT = 35;
const SUPABASE_URL = "https://juezglucqtenahnhsvri.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wvpNjf_yBYQyycCxFyGC3g_oOlXUytP";
const SUPABASE_MENU_BOXES_TABLE = "menu_boxes";
const GD_STATE_CHANGE_EVENT = "gd:statechange";
const GD_STORAGE_KEYS = {
    accounts: "gdAccounts",
    pendingScores: "pendingScores",
    scores: "scores",
    homeMenuBoxes: "gdHomeMenuBoxes"
};
const GD_ARRAY_KEYS = new Set([
    GD_STORAGE_KEYS.accounts,
    GD_STORAGE_KEYS.pendingScores,
    GD_STORAGE_KEYS.scores,
    GD_STORAGE_KEYS.homeMenuBoxes
]);
const LEGACY_AUTH_KEYS = ["gdLoggedIn", "gdUsername", "gdRole"];

let currentSession = null;
let authSubscription = null;
let homeMenuBoxesLoadPromise = null;
let homeMenuBoxesLoadUserId = "";
let homeMenuBoxesRealtimeChannel = null;
let homeMenuBoxesRealtimeUserId = "";
let homeMenuBoxesCache = [];

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function safeParseJson(value, fallback) {
    if (!value) {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        console.warn("Failed to parse stored JSON:", error);
        return fallback;
    }
}

function readLocalStoredArray(key) {
    const value = safeParseJson(localStorage.getItem(key), []);
    return Array.isArray(value) ? value : [];
}

function readStoredArray(key) {
    if (key === GD_STORAGE_KEYS.homeMenuBoxes) {
        return getHomeMenuBoxes();
    }

    return readLocalStoredArray(key);
}

function readStoredValue(key) {
    if (key === GD_STORAGE_KEYS.homeMenuBoxes) {
        return getHomeMenuBoxes();
    }

    if (GD_ARRAY_KEYS.has(key)) {
        return readStoredArray(key);
    }

    return localStorage.getItem(key);
}

function writeStoredArray(key, value, options = {}) {
    if (key === GD_STORAGE_KEYS.homeMenuBoxes) {
        setHomeMenuBoxesCache(value, options);
        return;
    }

    localStorage.setItem(key, JSON.stringify(value));
    if (options.notify !== false) {
        notifyStateChange(key, options.source || "local");
    }
}

function notifyStateChange(key, source = "local") {
    window.dispatchEvent(new CustomEvent(GD_STATE_CHANGE_EVENT, {
        detail: {
            key,
            source,
            value: readStoredValue(key)
        }
    }));
}

function normalizeStateKeys(keys) {
    if (!keys) {
        return null;
    }

    const rawKeys = Array.isArray(keys) ? keys : [keys];
    return new Set(rawKeys.map((key) => GD_STORAGE_KEYS[key] || key));
}

function onStateChange(keys, callback) {
    const watchedKeys = normalizeStateKeys(keys);
    const handler = (event) => {
        const detail = event.detail || {};
        if (!watchedKeys || watchedKeys.has(detail.key)) {
            callback(detail);
        }
    };

    window.addEventListener(GD_STATE_CHANGE_EVENT, handler);
    return () => window.removeEventListener(GD_STATE_CHANGE_EVENT, handler);
}

function onChange(keys, callback) {
    return onStateChange(keys, callback);
}

function getSupabaseClient() {
    if (window.supabaseClient) {
        return window.supabaseClient;
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
        return null;
    }

    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return window.supabaseClient;
}

function cleanupLegacyAuthStorage() {
    LEGACY_AUTH_KEYS.forEach((key) => {
        if (localStorage.getItem(key) !== null) {
            localStorage.removeItem(key);
        }
    });
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function getCurrentUser(session = currentSession) {
    return session && session.user ? session.user : null;
}

function getSessionEmail(session = currentSession) {
    const user = getCurrentUser(session);
    if (!user) {
        return "";
    }

    return normalizeEmail(user.email);
}

function getSessionRole(session = currentSession) {
    const user = getCurrentUser(session);
    if (!user) {
        return USER_ROLE;
    }

    return user.user_metadata && user.user_metadata.role === ADMIN_ROLE
        ? ADMIN_ROLE
        : USER_ROLE;
}

function authLoggedInEmail() {
    return getSessionEmail();
}

function isLoggedIn() {
    return Boolean(getCurrentUser());
}

function isAdminLoggedIn() {
    return isLoggedIn() && getSessionRole() === ADMIN_ROLE;
}

function currentRole() {
    return isLoggedIn() ? getSessionRole() : USER_ROLE;
}

function authDisplayName() {
    return authLoggedInEmail();
}

function authErrorElement() {
    return document.getElementById("errorText");
}

function showAuthError(message) {
    const errorText = authErrorElement();
    if (!errorText) {
        return;
    }

    errorText.innerText = message;
    errorText.classList.add("open");
}

function clearAuthError() {
    const errorText = authErrorElement();
    if (!errorText) {
        return;
    }

    errorText.classList.remove("open");
    errorText.innerText = "Wrong email or password.";
}

function normalizeAccountProfile(account) {
    const username = String(account && account.username || "").trim();
    if (!username) {
        return null;
    }

    const role = String(account && account.role || USER_ROLE).toLowerCase();
    return {
        username,
        role: role === ADMIN_ROLE ? ADMIN_ROLE : USER_ROLE,
        createdAt: account && account.createdAt ? account.createdAt : "Unknown",
        lastLogin: account && account.lastLogin ? account.lastLogin : "Never",
        points: Math.max(0, Math.floor(Number(account && account.points) || 0))
    };
}

function formatAccountTimestamp(value) {
    if (!value) {
        return "Never";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString();
}

async function getAccounts() {
    return readStoredArray(GD_STORAGE_KEYS.accounts)
        .map(normalizeAccountProfile)
        .filter(Boolean);
}

function saveAccounts(accounts, options = {}) {
    const normalizedAccounts = Array.isArray(accounts)
        ? accounts.map(normalizeAccountProfile).filter(Boolean)
        : [];

    writeStoredArray(GD_STORAGE_KEYS.accounts, normalizedAccounts, options);
}

async function getSupabaseAccounts() {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        throw new Error("Supabase is not available on this page.");
    }

    const user = getCurrentUser();
    if (!user) {
        return [];
    }

    const { data, error } = await supabaseClient.rpc("admin_list_accounts");
    if (error) {
        throw error;
    }

    return Array.isArray(data)
        ? data.map((account) => ({
            id: String(account && account.user_id || ""),
            email: String(account && account.email || ""),
            username: String(
                (account && account.username)
                || account && account.email
                || ""
            ).trim(),
            role: String(account && account.role || USER_ROLE).toLowerCase() === ADMIN_ROLE ? ADMIN_ROLE : USER_ROLE,
            createdAt: formatAccountTimestamp(account && account.created_at),
            lastLogin: formatAccountTimestamp(account && account.last_sign_in_at)
        })).filter((account) => account.id && account.username)
        : [];
}

function getPendingScores() {
    return readStoredArray(GD_STORAGE_KEYS.pendingScores);
}

function savePendingScores(pendingScores, options = {}) {
    writeStoredArray(GD_STORAGE_KEYS.pendingScores, pendingScores, options);
}

function getApprovedScores() {
    return readStoredArray(GD_STORAGE_KEYS.scores);
}

function saveApprovedScores(scores, options = {}) {
    writeStoredArray(GD_STORAGE_KEYS.scores, scores, options);
}

function getHomeMenuBoxes() {
    return homeMenuBoxesCache.map((item) => ({ ...item }));
}

function normalizeHomeMenuBoxes(items) {
    if (!Array.isArray(items)) {
        return [];
    }

    return items.map((item) => {
        const normalizedTitle = String((item && (item.title || item.text)) || "").trim();
        const normalizedContent = String((item && (item.content ?? item.description)) || "").trim();

        return {
            id: item && item.id ? String(item.id) : crypto.randomUUID(),
            title: normalizedTitle,
            content: normalizedContent,
            description: normalizedContent,
            createdAt: item && (item.createdAt || item.created_at) ? String(item.createdAt || item.created_at) : ""
        };
    }).filter((item) => item.title);
}

function setHomeMenuBoxesCache(items, options = {}) {
    homeMenuBoxesCache = normalizeHomeMenuBoxes(items);
    if (options.notify !== false) {
        notifyStateChange(GD_STORAGE_KEYS.homeMenuBoxes, options.source || "memory");
    }
    return getHomeMenuBoxes();
}

function requireMenuBoxesUser(options = {}) {
    const user = options.user || getCurrentUser(options.session || currentSession);
    if (!user) {
        throw new Error("You must be logged in to manage menu boxes.");
    }

    return user;
}

async function loadMenuBoxes(options = {}) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        return setHomeMenuBoxesCache([], {
            notify: options.notify !== false,
            source: "memory"
        });
    }

    const user = getCurrentUser(options.session || currentSession);
    if (!user) {
        return setHomeMenuBoxesCache([], {
            notify: options.notify !== false,
            source: options.source || "auth"
        });
    }

    try {
        const { data, error } = await supabaseClient
            .from(SUPABASE_MENU_BOXES_TABLE)
            .select("id, user_id, title, content, created_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: true });

        if (error) {
            throw error;
        }

        return setHomeMenuBoxesCache(Array.isArray(data) ? data : [], {
            notify: options.notify !== false,
            source: options.source || "remote"
        });
    } catch (error) {
        console.warn("Failed to load menu boxes from Supabase.", error);
        return getHomeMenuBoxes();
    }
}

async function loadHomeMenuBoxesFromSupabase(options = {}) {
    return loadMenuBoxes(options);
}

function ensureHomeMenuBoxesLoaded(options = {}) {
    const user = getCurrentUser(options.session || currentSession);
    const loadUserId = user ? user.id : "";

    if (!homeMenuBoxesLoadPromise || homeMenuBoxesLoadUserId !== loadUserId) {
        homeMenuBoxesLoadUserId = loadUserId;
        homeMenuBoxesLoadPromise = loadMenuBoxes(options).finally(() => {
            homeMenuBoxesLoadPromise = null;
            homeMenuBoxesLoadUserId = "";
        });
    }

    return homeMenuBoxesLoadPromise;
}

async function saveMenuBox(item, options = {}) {
    const normalizedItem = normalizeHomeMenuBoxes([item])[0];
    if (!normalizedItem) {
        throw new Error("Menu box title is required.");
    }

    const supabaseClient = getSupabaseClient();
    const user = requireMenuBoxesUser(options);
    if (!supabaseClient) {
        throw new Error("Supabase is not available on this page.");
    }

    const { data, error } = await supabaseClient
        .from(SUPABASE_MENU_BOXES_TABLE)
        .insert({
            user_id: user.id,
            title: normalizedItem.title,
            content: normalizedItem.content
        })
        .select("id, user_id, title, content, created_at")
        .single();

    if (error) {
        throw error;
    }

    const savedItem = normalizeHomeMenuBoxes([data])[0];
    setHomeMenuBoxesCache([...homeMenuBoxesCache, savedItem], {
        source: options.source || "remote"
    });
    return savedItem;
}

async function updateMenuBox(id, item, options = {}) {
    const normalizedItem = normalizeHomeMenuBoxes([{ ...item, id }])[0];
    if (!normalizedItem) {
        throw new Error("Menu box title is required.");
    }

    const supabaseClient = getSupabaseClient();
    const user = requireMenuBoxesUser(options);
    if (!supabaseClient) {
        throw new Error("Supabase is not available on this page.");
    }

    const { data, error } = await supabaseClient
        .from(SUPABASE_MENU_BOXES_TABLE)
        .update({
            title: normalizedItem.title,
            content: normalizedItem.content
        })
        .eq("id", id)
        .eq("user_id", user.id)
        .select("id, user_id, title, content, created_at")
        .single();

    if (error) {
        throw error;
    }

    const updatedItem = normalizeHomeMenuBoxes([data])[0];
    setHomeMenuBoxesCache(
        homeMenuBoxesCache.map((existingItem) => existingItem.id === updatedItem.id ? updatedItem : existingItem),
        { source: options.source || "remote" }
    );
    return updatedItem;
}

async function deleteMenuBox(id, options = {}) {
    const supabaseClient = getSupabaseClient();
    const user = requireMenuBoxesUser(options);
    if (!supabaseClient) {
        throw new Error("Supabase is not available on this page.");
    }

    const { error } = await supabaseClient
        .from(SUPABASE_MENU_BOXES_TABLE)
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);

    if (error) {
        throw error;
    }

    setHomeMenuBoxesCache(
        homeMenuBoxesCache.filter((item) => item.id !== id),
        { source: options.source || "remote" }
    );
}

async function saveHomeMenuBoxes(items, options = {}) {
    const normalizedItems = normalizeHomeMenuBoxes(items);
    const currentItems = getHomeMenuBoxes();

    const currentById = new Map(currentItems.map((item) => [item.id, item]));
    const nextById = new Map(normalizedItems.map((item) => [item.id, item]));

    for (const currentItem of currentItems) {
        if (!nextById.has(currentItem.id)) {
            await deleteMenuBox(currentItem.id, options);
        }
    }

    for (const nextItem of normalizedItems) {
        if (!currentById.has(nextItem.id)) {
            await saveMenuBox(nextItem, options);
            continue;
        }

        const currentItem = currentById.get(nextItem.id);
        if (currentItem.title !== nextItem.title || currentItem.content !== nextItem.content) {
            await updateMenuBox(nextItem.id, nextItem, options);
        }
    }

    return getHomeMenuBoxes();
}

function unsubscribeHomeMenuBoxesRealtime() {
    const supabaseClient = getSupabaseClient();
    if (supabaseClient && homeMenuBoxesRealtimeChannel && typeof supabaseClient.removeChannel === "function") {
        supabaseClient.removeChannel(homeMenuBoxesRealtimeChannel);
    }

    homeMenuBoxesRealtimeChannel = null;
    homeMenuBoxesRealtimeUserId = "";
}

function subscribeToRemoteHomeMenuBoxes(session = currentSession) {
    const supabaseClient = getSupabaseClient();
    const user = getCurrentUser(session);
    if (!supabaseClient || !user) {
        unsubscribeHomeMenuBoxesRealtime();
        return;
    }

    if (homeMenuBoxesRealtimeChannel && homeMenuBoxesRealtimeUserId === user.id) {
        return;
    }

    unsubscribeHomeMenuBoxesRealtime();

    homeMenuBoxesRealtimeChannel = supabaseClient
        .channel(`gd-home-menu-boxes-${user.id}`)
        .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: SUPABASE_MENU_BOXES_TABLE,
            filter: `user_id=eq.${user.id}`
        }, () => {
            loadMenuBoxes({ source: "remote", user }).catch((error) => {
                console.warn("Failed to refresh menu boxes from realtime event.", error);
            });
        })
        .subscribe((status) => {
            if (status === "CHANNEL_ERROR") {
                console.warn("Supabase realtime subscription failed for menu boxes.");
            }
        });

    homeMenuBoxesRealtimeUserId = user.id;
}

const gdAppState = {
    keys: GD_STORAGE_KEYS,
    onChange,
    getAccounts,
    getSupabaseAccounts,
    saveAccounts,
    getPendingScores,
    savePendingScores,
    getApprovedScores,
    saveApprovedScores,
    getHomeMenuBoxes,
    loadMenuBoxes,
    saveMenuBox,
    updateMenuBox,
    deleteMenuBox,
    saveHomeMenuBoxes,
    loadHomeMenuBoxesFromSupabase
};

window.gdAppState = gdAppState;

function buildAuthModeUi() {
    const popup = document.querySelector("#loginOverlay .auth-popup");
    if (!popup || document.getElementById("authModeSwitch")) {
        return;
    }

    const popupTitle = popup.querySelector("h2");
    const popupText = popup.querySelector(".auth-popup-text");
    const firstField = popup.querySelector(".auth-field");
    const emailLabel = popup.querySelector('label[for="username"]');
    const emailInput = popup.querySelector("#username");

    if (!popupTitle || !popupText || !firstField) {
        return;
    }

    popupTitle.id = "authPopupTitle";
    popupText.id = "authPopupText";

    const modeSwitch = document.createElement("div");
    modeSwitch.className = "auth-mode-switch";
    modeSwitch.id = "authModeSwitch";
    modeSwitch.innerHTML = `
        <button class="auth-mode-button" id="loginModeButton" type="button" onclick="setAuthMode('login')">Log In</button>
        <button class="auth-mode-button" id="signupModeButton" type="button" onclick="setAuthMode('signup')">Create Account</button>
    `;

    const helperText = document.createElement("p");
    helperText.className = "auth-helper-text";
    helperText.id = "authHelperText";
    helperText.textContent = "Use your real email and password for Supabase Auth.";

    if (emailLabel) {
        emailLabel.innerText = "Email";
    }

    if (emailInput) {
        emailInput.type = "email";
        emailInput.placeholder = "Email";
        emailInput.autocomplete = "email";
        emailInput.inputMode = "email";
    }

    popup.insertBefore(modeSwitch, firstField);
    popup.insertBefore(helperText, firstField);
}

function setAuthMode(mode) {
    authMode = mode;

    const title = document.getElementById("authPopupTitle");
    const text = document.getElementById("authPopupText");
    const submitButton = document.querySelector("#loginOverlay .auth-full");
    const loginModeButton = document.getElementById("loginModeButton");
    const signupModeButton = document.getElementById("signupModeButton");

    if (!title || !text || !submitButton || !loginModeButton || !signupModeButton) {
        return;
    }

    if (mode === "signup") {
        title.innerText = "Create Account";
        text.innerText = "Sign up with your email and password.";
        submitButton.innerText = "Create Account";
        loginModeButton.classList.remove("active");
        signupModeButton.classList.add("active");
    } else {
        title.innerText = "Log In";
        text.innerText = "Log in with your email and password.";
        submitButton.innerText = "Log In";
        loginModeButton.classList.add("active");
        signupModeButton.classList.remove("active");
    }

    clearAuthError();
}

function openLoginPopup() {
    const overlay = document.getElementById("loginOverlay");
    if (!overlay) {
        return;
    }

    overlay.classList.add("open");
    clearAuthError();
}

function closeLoginPopup() {
    const overlay = document.getElementById("loginOverlay");
    if (overlay) {
        overlay.classList.remove("open");
    }
}

function openAccountPopup() {
    const overlay = document.getElementById("accountOverlay");
    if (overlay) {
        overlay.classList.add("open");
    }
}

function closeAccountPopup() {
    const overlay = document.getElementById("accountOverlay");
    if (overlay) {
        overlay.classList.remove("open");
    }
}

function clearAuthInputs() {
    const emailInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");

    if (emailInput) {
        emailInput.value = "";
    }

    if (passwordInput) {
        passwordInput.value = "";
    }
}

function applyAuthInputLimits() {
    const emailInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");

    if (emailInput) {
        emailInput.maxLength = 254;
    }

    if (passwordInput) {
        passwordInput.maxLength = AUTH_TEXT_LIMIT;
    }
}

function prefillPlayerName(inputId) {
    const input = document.getElementById(inputId);
    const username = authDisplayName();

    if (!input || !username || input.value.trim()) {
        return;
    }

    input.value = username;
}

async function updateLoginView() {
    const email = authLoggedInEmail();
    const role = currentRole();
    const displayName = email || "Guest";
    const loginButton = document.getElementById("loginButton");
    const loginInfo = document.getElementById("loginInfo");
    const loginName = document.getElementById("loginName");
    const panelName = document.getElementById("panelName");
    const loginRole = document.getElementById("loginRole");
    const panelRole = document.getElementById("panelRole");

    if (loginName) {
        loginName.innerText = displayName;
    }

    if (panelName) {
        panelName.innerText = displayName;
    }

    if (loginRole) {
        loginRole.innerText = isLoggedIn() ? role : USER_ROLE;
    }

    if (panelRole) {
        panelRole.innerText = isLoggedIn() ? role : USER_ROLE;
    }

    if (loginButton) {
        loginButton.style.display = isLoggedIn() ? "none" : "inline-block";
    }

    if (loginInfo) {
        loginInfo.classList.toggle("open", isLoggedIn());
    }

    if (typeof updatePageForAuth === "function") {
        await updatePageForAuth();
    }
}

function mapSupabaseAuthError(error, fallbackMessage) {
    const rawMessage = String(error && error.message || "").trim();
    const message = rawMessage.toLowerCase();

    if (message.includes("invalid login credentials")) {
        return "Wrong email or password.";
    }

    if (message.includes("already registered") || message.includes("already been registered")) {
        return "That email already exists.";
    }

    if (message.includes("email not confirmed")) {
        return "Email confirmation is enabled in Supabase Auth. Confirm the email or disable email confirmation.";
    }

    if (rawMessage) {
        return rawMessage;
    }

    return fallbackMessage;
}

function createAuthPayload(email, password) {
    return {
        email: normalizeEmail(email),
        password
    };
}

async function createAccount(email, password) {
    const cleanEmail = normalizeEmail(email);

    if (!cleanEmail || !password) {
        showAuthError("Type both an email and a password.");
        return;
    }

    if (cleanEmail.length > 254) {
        showAuthError("Email must be 254 characters or less.");
        return;
    }

    if (password.length > AUTH_TEXT_LIMIT) {
        showAuthError(`Password must be ${AUTH_TEXT_LIMIT} characters or less.`);
        return;
    }

    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        showAuthError("Supabase Auth is not loaded on this page.");
        console.error("Supabase client is unavailable during signup.");
        return;
    }

    const { data, error } = await supabaseClient.auth.signUp(
        createAuthPayload(cleanEmail, password)
    );

    if (error) {
        console.error("Supabase signup failed:", error);
        showAuthError(mapSupabaseAuthError(error, "Signup failed."));
        return;
    }

    if (!data.session) {
        console.error("Supabase signup returned no session. Email confirmation is likely enabled.", data);
        showAuthError("Signup succeeded, but no session was created. Confirm the email or disable email confirmation.");
        return;
    }

    currentSession = data.session;
    closeLoginPopup();
    clearAuthInputs();
    clearAuthError();
    await updateLoginView();
    alert("Account created!");
}

async function logIntoAccount(email, password) {
    const cleanEmail = normalizeEmail(email);

    if (!cleanEmail || !password) {
        showAuthError("Type both an email and a password.");
        return;
    }

    if (cleanEmail.length > 254) {
        showAuthError("Email must be 254 characters or less.");
        return;
    }

    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        showAuthError("Supabase Auth is not loaded on this page.");
        console.error("Supabase client is unavailable during login.");
        return;
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: cleanEmail,
        password
    });

    if (error || !data.session) {
        console.error("Supabase login failed:", {
            email: cleanEmail,
            error
        });
        showAuthError(mapSupabaseAuthError(error, "Login failed."));
        return;
    }

    currentSession = data.session;
    closeLoginPopup();
    clearAuthInputs();
    clearAuthError();
    await updateLoginView();
}

async function submitLogin() {
    const emailInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const email = emailInput ? emailInput.value.trim() : "";
    const password = passwordInput ? passwordInput.value : "";

    if (authMode === "signup") {
        await createAccount(email, password);
    } else {
        await logIntoAccount(email, password);
    }
}

async function logOut() {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        currentSession = null;
        closeAccountPopup();
        await updateLoginView();
        return;
    }

    const { error } = await supabaseClient.auth.signOut();
    if (error) {
        console.error("Supabase logout failed:", error);
    }

    currentSession = null;
    closeAccountPopup();
    await updateLoginView();
}

async function handleAuthSessionChanged(session, options = {}) {
    currentSession = session || null;
    cleanupLegacyAuthStorage();

    if (currentSession) {
        await ensureHomeMenuBoxesLoaded({
            notify: options.notify !== false,
            session: currentSession,
            source: options.source || "auth"
        });
        subscribeToRemoteHomeMenuBoxes(currentSession);
    } else {
        unsubscribeHomeMenuBoxesRealtime();
        setHomeMenuBoxesCache([], {
            notify: options.notify !== false,
            source: options.source || "auth"
        });
    }

    await updateLoginView();
}

function subscribeToSupabaseAuth() {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient || authSubscription) {
        return;
    }

    const subscriptionResult = supabaseClient.auth.onAuthStateChange((_event, session) => {
        handleAuthSessionChanged(session, { source: "auth-change" }).catch((error) => {
            console.error("Auth state change handler failed:", error);
        });
    });

    authSubscription = subscriptionResult && subscriptionResult.data
        ? subscriptionResult.data.subscription
        : null;
}

async function initializeAuthUi() {
    cleanupLegacyAuthStorage();
    buildAuthModeUi();
    applyAuthInputLimits();
    setAuthMode("login");

    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        console.error("Supabase client could not be created during auth initialization.");
        await updateLoginView();
        return;
    }

    subscribeToSupabaseAuth();

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
        console.error("Supabase getSession failed:", error);
    }

    await handleAuthSessionChanged(data && data.session ? data.session : null, { source: "restore" });
}

window.initializeAuthUi = initializeAuthUi;

function runWhenDomReady(callback) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", callback, { once: true });
        return;
    }

    callback();
}

window.addEventListener("storage", (event) => {
    if (!event.key || !Object.values(GD_STORAGE_KEYS).includes(event.key)) {
        return;
    }

    notifyStateChange(event.key, "storage");
});

runWhenDomReady(() => {
    initializeAuthUi().catch((error) => {
        console.error("Auth initialization failed:", error);
    });
});
