const ADMIN_USERNAME = "Bab9104";
const ADMIN_ROLE = "Admin";
const PLAYER_ROLE = "Player";

let authMode = "login";

// Front-end only note:
// - This project uses localStorage (no server), so this improves storage (no plain-text),
//   but it is not equivalent to real server-side password security.
const AUTH_TEXT_LIMIT = 35;

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
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

    const email = username + "@gd.local";

    // 1. CREATE AUTH USER (THIS IS WHAT YOU ARE MISSING)
    const { data: signUpData, error: signUpError } = await supabaseClient.auth.signUp({
        email,
        password
    });

    if (signUpError) {
        console.log(signUpError);
        showAuthError("Signup failed.");
        return;
    }

    // 2. CREATE PROFILE ROW
    const { error } = await supabaseClient
        .from("users")
        .insert([
            {
                username: username,
                points: 0
            }
        ]);

    if (error) {
        console.log(error);
        showAuthError("Error saving profile.");
        return;
    }

    localStorage.setItem("gdLoggedIn", "true");
    localStorage.setItem("gdUsername", username);
    localStorage.setItem("gdRole", username === ADMIN_USERNAME ? "Admin" : "Player");

    closeLoginPopup();
    clearAuthInputs();
    clearAuthError();
    await updateLoginView();

    alert("Account created!");
}

async function submitLogin() {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    if (!username || !password) {
        showAuthError("Please enter username and password.");
        return;
    }

    const email = username + "@gd.local";

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
    });

    if (error || !data.user) {
        showAuthError("Wrong username or password.");
        return;
    }

    localStorage.setItem("gdLoggedIn", "true");
    localStorage.setItem("gdUsername", username);
    localStorage.setItem("gdRole", "Player");

    closeLoginPopup();
    clearAuthInputs();
    clearAuthError();
    await updateLoginView();
}


function logOut() {
    localStorage.removeItem("gdLoggedIn");
    localStorage.removeItem("gdUsername");
    localStorage.removeItem("gdRole");
    closeAccountPopup();
    updateLoginView();
}

document.addEventListener("DOMContentLoaded", () => {
    initializeAuthUi();
});

