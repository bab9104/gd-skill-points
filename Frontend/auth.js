const ADMIN_USERNAME = "Bab9104";
const ADMIN_ROLE = "Admin";
const PLAYER_ROLE = "Player";

let authMode = "login";

// Front-end only note:
// - This project uses localStorage (no server), so this improves storage (no plain-text),
//   but it is not equivalent to real server-side password security.
const DEFAULT_ADMIN_PASSWORD = "BabHtmlfileLol124";
const PBKDF2_ITERATIONS = 150000;
const PBKDF2_HASH = "SHA-256";
const PASSWORD_HASH_BITS = 256;
const AUTH_TEXT_LIMIT = 35;

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function base64FromBytes(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function bytesFromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function randomSaltBase64(byteLength = 16) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return base64FromBytes(bytes);
}

async function hashPassword(password, saltBase64) {
    const encoder = new TextEncoder();
    const passwordBytes = encoder.encode(password);
    const saltBytes = bytesFromBase64(saltBase64);

    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        passwordBytes,
        "PBKDF2",
        false,
        ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: saltBytes,
            iterations: PBKDF2_ITERATIONS,
            hash: PBKDF2_HASH
        },
        keyMaterial,
        PASSWORD_HASH_BITS
    );

    return base64FromBytes(new Uint8Array(derivedBits));
}

async function migrateAccountPasswords(accounts) {
    let changed = false;

    for (const account of accounts) {
        if (!account || typeof account.username !== "string") {
            continue;
        }

        const isAdmin = account.username === ADMIN_USERNAME;
        if (isAdmin) {
            account.role = ADMIN_ROLE;
            account.createdAt = account.createdAt || "Built-in admin account";
            account.lastLogin = account.lastLogin || "Never";
        } else {
            account.role = account.role || PLAYER_ROLE;
            account.createdAt = account.createdAt || "Unknown";
            account.lastLogin = account.lastLogin || "Never";
        }

        const normalizedPoints = Number(account.points);
        if (!Number.isFinite(normalizedPoints) || normalizedPoints < 0) {
            account.points = 0;
            changed = true;
        } else {
            account.points = Math.floor(normalizedPoints);
        }

        if (account.passwordHash && account.passwordSalt) {
            if (account.password) {
                delete account.password;
                changed = true;
            }
            continue;
        }

        // Legacy accounts stored `password` in plain text. Convert to salted hash.
        if (typeof account.password === "string" && account.password.length > 0) {
            const salt = randomSaltBase64();
            const passwordHash = await hashPassword(account.password, salt);
            account.passwordSalt = salt;
            account.passwordHash = passwordHash;
            account.passwordAlgo = `PBKDF2-${PBKDF2_HASH}-${PBKDF2_ITERATIONS}`;
            delete account.password;
            changed = true;
            continue;
        }

        // Admin should always have a password hash, even if storage was cleared.
        if (isAdmin) {
            const salt = randomSaltBase64();
            const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD, salt);
            account.passwordSalt = salt;
            account.passwordHash = passwordHash;
            account.passwordAlgo = `PBKDF2-${PBKDF2_HASH}-${PBKDF2_ITERATIONS}`;
            changed = true;
        }
    }

    return changed;
}

async function getAccounts() {
    const accounts = JSON.parse(localStorage.getItem("gdAccounts")) || [];

    let hasAdmin = false;
    for (const account of accounts) {
        if (account && account.username === ADMIN_USERNAME) {
            hasAdmin = true;
            break;
        }
    }

    if (!hasAdmin) {
        accounts.push({
            username: ADMIN_USERNAME,
            role: ADMIN_ROLE,
            points: 0,
            createdAt: "Built-in admin account",
            lastLogin: "Never"
        });
    }

    const changed = await migrateAccountPasswords(accounts);
    if (changed || !hasAdmin) {
        localStorage.setItem("gdAccounts", JSON.stringify(accounts));
    }

    return accounts;
}

function saveAccounts(accounts) {
    localStorage.setItem("gdAccounts", JSON.stringify(accounts));
}

async function findAccount(username) {
    const normalized = username.trim().toLowerCase();
    const accounts = await getAccounts();
    return accounts.find((account) => String(account.username || "").toLowerCase() === normalized);
}

function authLoggedInUsername() {
    return localStorage.getItem("gdUsername") || "";
}

function isLoggedIn() {
    return localStorage.getItem("gdLoggedIn") === "true";
}

function isAdminLoggedIn() {
    return isLoggedIn() && authLoggedInUsername() === ADMIN_USERNAME;
}

function currentRole() {
    return localStorage.getItem("gdRole") || PLAYER_ROLE;
}

function authDisplayName() {
    return authLoggedInUsername() || "";
}

function authErrorElement() {
    return document.getElementById("errorText");
}

function showAuthError(message) {
    const errorText = authErrorElement();
    errorText.innerText = message;
    errorText.classList.add("open");
}

function clearAuthError() {
    const errorText = authErrorElement();
    errorText.classList.remove("open");
    errorText.innerText = "Wrong username or password.";
}

function buildAuthModeUi() {
    const popup = document.querySelector("#loginOverlay .auth-popup");
    if (!popup || document.getElementById("authModeSwitch")) {
        return;
    }

    const popupTitle = popup.querySelector("h2");
    const popupText = popup.querySelector(".auth-popup-text");
    const firstField = popup.querySelector(".auth-field");

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
    helperText.textContent = "Try to use your Geometry Dash username if you want, but you do not have to.";

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

    if (mode === "signup") {
        title.innerText = "Create Account";
        text.innerText = "Make an account so your name stays saved even after you log out.";
        submitButton.innerText = "Create Account";
        loginModeButton.classList.remove("active");
        signupModeButton.classList.add("active");
    } else {
        title.innerText = "Log In";
        text.innerText = "Log in with an account you already made.";
        submitButton.innerText = "Log In";
        loginModeButton.classList.add("active");
        signupModeButton.classList.remove("active");
    }

    clearAuthError();
}

function openLoginPopup() {
    document.getElementById("loginOverlay").classList.add("open");
    clearAuthError();
}

function closeLoginPopup() {
    document.getElementById("loginOverlay").classList.remove("open");
}

function openAccountPopup() {
    document.getElementById("accountOverlay").classList.add("open");
}

function closeAccountPopup() {
    document.getElementById("accountOverlay").classList.remove("open");
}

function clearAuthInputs() {
    document.getElementById("username").value = "";
    document.getElementById("password").value = "";
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

async function updateLoginView() {
    await getAccounts();

    const loginButton = document.getElementById("loginButton");
    const loginInfo = document.getElementById("loginInfo");
    const username = authLoggedInUsername();
    const role = currentRole();

    document.getElementById("loginName").innerText = username || ADMIN_USERNAME;
    document.getElementById("panelName").innerText = username || ADMIN_USERNAME;
    document.getElementById("loginRole").innerText = role;
    document.getElementById("panelRole").innerText = role;

    if (isLoggedIn()) {
        loginButton.style.display = "none";
        loginInfo.classList.add("open");
    } else {
        loginButton.style.display = "inline-block";
        loginInfo.classList.remove("open");
    }

    if (typeof updatePageForAuth === "function") {
        await updatePageForAuth();
    }
}

function prefillPlayerName(inputId) {
    const input = document.getElementById(inputId);
    const username = authDisplayName();

    if (!input || !username) {
        return;
    }

    if (!input.value.trim()) {
        input.value = username;
    }
}

async function createAccount(username, password) {
    if (!username || !password) {
        showAuthError("Type both a username and a password.");
        return;
    }

    if (username.length > AUTH_TEXT_LIMIT || password.length > AUTH_TEXT_LIMIT) {
        showAuthError(`Username and password must be ${AUTH_TEXT_LIMIT} characters or less.`);
        return;
    }

    if (await findAccount(username)) {
        showAuthError("That username already exists.");
        return;
    }

    const accounts = await getAccounts();
    const salt = randomSaltBase64();
    const passwordHash = await hashPassword(password, salt);
    const newAccount = {
        username,
        passwordSalt: salt,
        passwordHash,
        passwordAlgo: `PBKDF2-${PBKDF2_HASH}-${PBKDF2_ITERATIONS}`,
        role: PLAYER_ROLE,
        points: 0,
        createdAt: new Date().toLocaleString(),
        lastLogin: "Just created"
    };

    accounts.push(newAccount);
    saveAccounts(accounts);

    localStorage.setItem("gdLoggedIn", "true");
    localStorage.setItem("gdUsername", newAccount.username);
    localStorage.setItem("gdRole", newAccount.role);

    closeLoginPopup();
    clearAuthInputs();
    clearAuthError();
    await updateLoginView();
    alert("Account created!");
}

async function logIntoAccount(username, password) {
    if (username.length > AUTH_TEXT_LIMIT || password.length > AUTH_TEXT_LIMIT) {
        showAuthError(`Username and password must be ${AUTH_TEXT_LIMIT} characters or less.`);
        return;
    }

    const account = await findAccount(username);
    if (!account) {
        showAuthError("Wrong username or password.");
        return;
    }

    if (account.passwordSalt && account.passwordHash) {
        const attemptHash = await hashPassword(password, account.passwordSalt);
        if (attemptHash !== account.passwordHash) {
            showAuthError("Wrong username or password.");
            return;
        }
    } else if (typeof account.password === "string") {
        // Legacy fallback (should be migrated on page load, but keep this for safety).
        if (account.password !== password) {
            showAuthError("Wrong username or password.");
            return;
        }
        const salt = randomSaltBase64();
        account.passwordSalt = salt;
        account.passwordHash = await hashPassword(password, salt);
        account.passwordAlgo = `PBKDF2-${PBKDF2_HASH}-${PBKDF2_ITERATIONS}`;
        delete account.password;
    } else {
        showAuthError("This account needs a password reset.");
        return;
    }

    const accounts = await getAccounts();
    const now = new Date().toLocaleString();
    const updated = accounts.map((savedAccount) => {
        if (savedAccount.username === account.username) {
            return { ...savedAccount, lastLogin: now };
        }
        return savedAccount;
    });

    saveAccounts(updated);
    localStorage.setItem("gdLoggedIn", "true");
    localStorage.setItem("gdUsername", account.username);
    localStorage.setItem("gdRole", account.role || PLAYER_ROLE);

    closeLoginPopup();
    clearAuthInputs();
    clearAuthError();
    await updateLoginView();
}

async function submitLogin() {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    if (authMode === "signup") {
        await createAccount(username, password);
    } else {
        const res = await fetch("https://gd-skill-points.onrender.com/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
});

const data = await res.json();

if (!res.ok) {
    showAuthError(data.error || "Login failed");
    return;
}

localStorage.setItem("gdLoggedIn", "true");
localStorage.setItem("gdUsername", data.user.username);
localStorage.setItem("gdRole", data.user.role);

closeLoginPopup();
clearAuthInputs();
await updateLoginView();
    }
}

function logOut() {
    localStorage.removeItem("gdLoggedIn");
    localStorage.removeItem("gdUsername");
    localStorage.removeItem("gdRole");
    closeAccountPopup();
    updateLoginView();
}

async function initializeAuthUi() {
    await getAccounts();
    applyAuthInputLimits();
    buildAuthModeUi();
    setAuthMode("login");
    await updateLoginView();
}

document.addEventListener("DOMContentLoaded", () => {
    initializeAuthUi();
});

