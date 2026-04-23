const ADMIN_USERNAME = "Bab9104";
const ADMIN_ROLE = "Admin";
const PLAYER_ROLE = "Player";

let authMode = "login";

const AUTH_TEXT_LIMIT = 35;
const SUPABASE_URL = "https://juezglucqtenahnhsvri.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wvpNjf_yBYQyycCxFyGC3g_oOlXUytP";
const SUPABASE_SETTINGS_TABLE = "site_settings";
const SUPABASE_HOME_MENU_BOXES_KEY = "home_menu_boxes";
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
let homeMenuBoxesRealtimeChannel = null;

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

function readStoredArray(key) {
    const value = safeParseJson(localStorage.getItem(key), []);
    return Array.isArray(value) ? value : [];
}

function readStoredValue(key) {
    if (GD_ARRAY_KEYS.has(key)) {
        return readStoredArray(key);
    }

    return localStorage.getItem(key);
}

function writeStoredArray(key, value, options = {}) {
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

function normalizeUsername(username) {
    return String(username || "").trim();
}

function usernameToEmail(username) {
    return `${normalizeUsername(username).toLowerCase()}@gd.local`;
}

function emailToUsername(email) {
    return String(email || "").split("@")[0] || "";
}

function getCurrentUser(session = currentSession) {
    return session && session.user ? session.user : null;
}

function getSessionEmail(session = currentSession) {
    const user = getCurrentUser(session);
    return user && user.email ? String(user.email).toLowerCase() : "";
}

function getSessionUsername(session = currentSession) {
    const user = getCurrentUser(session);
    if (!user) {
        return "";
    }

    const metadataUsername = String(user.user_metadata && user.user_metadata.username || "").trim();
    return metadataUsername || emailToUsername(user.email);
}

function getSessionRole(session = currentSession) {
    const user = getCurrentUser(session);
    if (!user) {
        return PLAYER_ROLE;
    }

    const email = getSessionEmail(session);
    const metadataRole = String(
        (user.app_metadata && user.app_metadata.role)
        || (user.user_metadata && user.user_metadata.role)
        || ""
    ).trim();

    if (email === usernameToEmail(ADMIN_USERNAME) || metadataRole === ADMIN_ROLE) {
        return ADMIN_ROLE;
    }

    return PLAYER_ROLE;
}

function authLoggedInUsername() {
    return getSessionUsername();
}

function isLoggedIn() {
    return Boolean(getCurrentUser());
}

function isAdminLoggedIn() {
    return isLoggedIn() && getSessionRole() === ADMIN_ROLE;
}

function currentRole() {
    return isLoggedIn() ? getSessionRole() : PLAYER_ROLE;
}

function authDisplayName() {
    return authLoggedInUsername();
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
    errorText.innerText = "Wrong username or password.";
}

function normalizeAccountProfile(account) {
    const username = normalizeUsername(account && account.username);
    if (!username) {
        return null;
    }

    return {
        username,
        role: account && account.role ? account.role : PLAYER_ROLE,
        createdAt: account && account.createdAt ? account.createdAt : "Unknown",
        lastLogin: account && account.lastLogin ? account.lastLogin : "Never",
        points: Math.max(0, Math.floor(Number(account && account.points) || 0))
    };
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

async function syncSessionProfile(session, options = {}) {
    const username = getSessionUsername(session);
    if (!username) {
        return;
    }

    const role = getSessionRole(session);
    const loginTime = new Date().toLocaleString();
    const user = getCurrentUser(session);
    const createdAt = new Date(user && user.created_at ? user.created_at : Date.now()).toLocaleString();
    const accounts = await getAccounts();
    let found = false;

    const updatedAccounts = accounts.map((account) => {
        if (account.username !== username) {
            return account;
        }

        found = true;
        return {
            ...account,
            role,
            createdAt: account.createdAt || createdAt,
            lastLogin: options.markLogin ? loginTime : (account.lastLogin || "Never")
        };
    });

    if (!found) {
        updatedAccounts.push({
            username,
            role,
            createdAt,
            lastLogin: options.markLogin ? loginTime : "Never",
            points: 0
        });
    }

    saveAccounts(updatedAccounts, { source: options.source || "auth" });
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
    return readStoredArray(GD_STORAGE_KEYS.homeMenuBoxes);
}

function normalizeHomeMenuBoxes(items) {
    if (!Array.isArray(items)) {
        return [];
    }

    return items.map((item) => {
        const normalizedTitle = String((item && (item.title || item.text)) || "").trim();
        const normalizedDescription = String((item && item.description) || "").trim();

        return {
            id: item && item.id ? String(item.id) : crypto.randomUUID(),
            title: normalizedTitle,
            description: normalizedDescription
        };
    }).filter((item) => item.title);
}

async function loadHomeMenuBoxesFromSupabase(options = {}) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        return getHomeMenuBoxes();
    }

    try {
        const { data, error } = await supabaseClient
            .from(SUPABASE_SETTINGS_TABLE)
            .select("value")
            .eq("key", SUPABASE_HOME_MENU_BOXES_KEY)
            .maybeSingle();

        if (error) {
            throw error;
        }

        const items = normalizeHomeMenuBoxes(data && Array.isArray(data.value) ? data.value : []);
        writeStoredArray(GD_STORAGE_KEYS.homeMenuBoxes, items, {
            notify: options.notify !== false,
            source: "remote"
        });
        return items;
    } catch (error) {
        console.warn("Failed to load menu boxes from Supabase. Falling back to localStorage.", error);
        return getHomeMenuBoxes();
    }
}

function ensureHomeMenuBoxesLoaded() {
    if (!homeMenuBoxesLoadPromise) {
        homeMenuBoxesLoadPromise = loadHomeMenuBoxesFromSupabase().finally(() => {
            homeMenuBoxesLoadPromise = null;
        });
    }

    return homeMenuBoxesLoadPromise;
}

async function saveHomeMenuBoxes(items, options = {}) {
    const normalizedItems = normalizeHomeMenuBoxes(items);
    writeStoredArray(GD_STORAGE_KEYS.homeMenuBoxes, normalizedItems, options);

    if (options.remote === false) {
        return normalizedItems;
    }

    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        return normalizedItems;
    }

    try {
        const { error } = await supabaseClient
            .from(SUPABASE_SETTINGS_TABLE)
            .upsert({
                key: SUPABASE_HOME_MENU_BOXES_KEY,
                value: normalizedItems
            }, {
                onConflict: "key"
            });

        if (error) {
            throw error;
        }
    } catch (error) {
        console.warn("Failed to save menu boxes to Supabase. Local copy was kept.", error);
    }

    return normalizedItems;
}

function subscribeToRemoteHomeMenuBoxes() {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient || homeMenuBoxesRealtimeChannel) {
        return;
    }

    homeMenuBoxesRealtimeChannel = supabaseClient
        .channel("gd-home-menu-boxes")
        .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: SUPABASE_SETTINGS_TABLE,
            filter: `key=eq.${SUPABASE_HOME_MENU_BOXES_KEY}`
        }, () => {
            loadHomeMenuBoxesFromSupabase();
        })
        .subscribe((status) => {
            if (status === "CHANNEL_ERROR") {
                console.warn("Supabase realtime subscription failed for menu boxes.");
            }
        });
}

const gdAppState = {
    keys: GD_STORAGE_KEYS,
    onChange,
    getAccounts,
    saveAccounts,
    getPendingScores,
    savePendingScores,
    getApprovedScores,
    saveApprovedScores,
    getHomeMenuBoxes,
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
    helperText.textContent = "Use a username and password. Internally the username becomes username@gd.local in Supabase Auth.";

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
        text.innerText = "Sign up with a username and password.";
        submitButton.innerText = "Create Account";
        loginModeButton.classList.remove("active");
        signupModeButton.classList.add("active");
    } else {
        title.innerText = "Log In";
        text.innerText = "Log in with a username and password.";
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
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");

    if (usernameInput) {
        usernameInput.value = "";
    }

    if (passwordInput) {
        passwordInput.value = "";
    }
}

function applyAuthInputLimits() {
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");

    if (usernameInput) {
        usernameInput.maxLength = AUTH_TEXT_LIMIT;
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
    const username = authLoggedInUsername();
    const role = currentRole();
    const displayName = username || ADMIN_USERNAME;
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
        loginRole.innerText = isLoggedIn() ? role : ADMIN_ROLE;
    }

    if (panelRole) {
        panelRole.innerText = isLoggedIn() ? role : ADMIN_ROLE;
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
        return "Wrong username or password.";
    }

    if (message.includes("already registered") || message.includes("already been registered")) {
        return "That username already exists.";
    }

    if (message.includes("email not confirmed")) {
        return "Email confirmation is enabled in Supabase Auth. Turn it off for gd.local usernames.";
    }

    if (rawMessage) {
        return rawMessage;
    }

    return fallbackMessage;
}

function createAuthPayload(username, password) {
    const cleanUsername = normalizeUsername(username);

    return {
        email: usernameToEmail(cleanUsername),
        password,
        options: {
            data: {
                username: cleanUsername
            }
        }
    };
}

async function createAccount(username, password) {
    const cleanUsername = normalizeUsername(username);

    if (!cleanUsername || !password) {
        showAuthError("Type both a username and a password.");
        return;
    }

    if (cleanUsername.length > AUTH_TEXT_LIMIT || password.length > AUTH_TEXT_LIMIT) {
        showAuthError(`Username and password must be ${AUTH_TEXT_LIMIT} characters or less.`);
        return;
    }

    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        showAuthError("Supabase Auth is not loaded on this page.");
        console.error("Supabase client is unavailable during signup.");
        return;
    }

    const { data, error } = await supabaseClient.auth.signUp(
        createAuthPayload(cleanUsername, password)
    );

    if (error) {
        console.error("Supabase signup failed:", error);
        showAuthError(mapSupabaseAuthError(error, "Signup failed."));
        return;
    }

    if (!data.session) {
        console.error("Supabase signup returned no session. Email confirmation is likely enabled.", data);
        showAuthError("Signup succeeded, but no session was created. Turn off email confirmation for gd.local usernames.");
        return;
    }

    currentSession = data.session;
    await syncSessionProfile(data.session, { markLogin: true, source: "signup" });
    closeLoginPopup();
    clearAuthInputs();
    clearAuthError();
    await updateLoginView();
    alert("Account created!");
}

async function logIntoAccount(username, password) {
    const cleanUsername = normalizeUsername(username);

    if (!cleanUsername || !password) {
        showAuthError("Type both a username and a password.");
        return;
    }

    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        showAuthError("Supabase Auth is not loaded on this page.");
        console.error("Supabase client is unavailable during login.");
        return;
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: usernameToEmail(cleanUsername),
        password
    });

    if (error || !data.session) {
        console.error("Supabase login failed:", {
            username: cleanUsername,
            email: usernameToEmail(cleanUsername),
            error
        });
        showAuthError(mapSupabaseAuthError(error, "Login failed."));
        return;
    }

    currentSession = data.session;
    await syncSessionProfile(data.session, { markLogin: true, source: "login" });
    closeLoginPopup();
    clearAuthInputs();
    clearAuthError();
    await updateLoginView();
}

async function submitLogin() {
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const username = usernameInput ? usernameInput.value.trim() : "";
    const password = passwordInput ? passwordInput.value : "";

    if (authMode === "signup") {
        await createAccount(username, password);
    } else {
        await logIntoAccount(username, password);
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
        await syncSessionProfile(currentSession, {
            markLogin: Boolean(options.markLogin),
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
    ensureHomeMenuBoxesLoaded();
    subscribeToRemoteHomeMenuBoxes();
});
