const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_ADMIN_USERNAME = process.env.GD_ADMIN_USERNAME || "Bab9104";
const DEFAULT_ADMIN_PASSWORD = process.env.GD_ADMIN_PASSWORD || "BabHtmlfileLol124";
const AUTH_TEXT_LIMIT = 35;
const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "app-data.json");

function nowIso() {
    return new Date().toISOString();
}

function createId(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
}

function randomToken() {
    return crypto.randomBytes(48).toString("hex");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    const iterations = 150000;
    const keyLength = 64;
    const digest = "sha512";
    const hash = crypto.pbkdf2Sync(password, salt, iterations, keyLength, digest).toString("hex");
    return { salt, iterations, keyLength, digest, hash };
}

function verifyPassword(password, user) {
    if (!user || !user.passwordHash || !user.passwordSalt) {
        return false;
    }

    const attempt = crypto.pbkdf2Sync(
        password,
        user.passwordSalt,
        user.passwordIterations || 150000,
        user.passwordKeyLength || 64,
        user.passwordDigest || "sha512"
    ).toString("hex");

    const storedBuffer = Buffer.from(user.passwordHash, "hex");
    const attemptBuffer = Buffer.from(attempt, "hex");
    if (storedBuffer.length !== attemptBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(storedBuffer, attemptBuffer);
}

function ensureDataFile() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(DATA_FILE)) {
        const data = {
            users: [],
            sessions: [],
            scores: [],
            challenges: [],
            challengeSubmissions: [],
            menuBoxes: []
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    normalizeData(data);
    ensureAdminUser(data);
    saveData(data);
}

function loadData() {
    ensureDataFile();
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    normalizeData(data);
    ensureAdminUser(data);
    return data;
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function normalizeData(data) {
    data.users = Array.isArray(data.users) ? data.users : [];
    data.sessions = Array.isArray(data.sessions) ? data.sessions : [];
    data.scores = Array.isArray(data.scores) ? data.scores : [];
    data.challenges = Array.isArray(data.challenges) ? data.challenges : [];
    data.challengeSubmissions = Array.isArray(data.challengeSubmissions) ? data.challengeSubmissions : [];
    data.menuBoxes = Array.isArray(data.menuBoxes) ? data.menuBoxes : [];

    data.users.forEach((user) => {
        user.points = Math.max(0, Math.floor(Number(user.points) || 0));
        user.role = user.role === "admin" ? "admin" : "user";
        user.createdAt = user.createdAt || nowIso();
        user.updatedAt = user.updatedAt || user.createdAt;
    });

    data.menuBoxes.forEach((menuBox) => {
        menuBox.title = String(menuBox.title || "").trim();
        menuBox.description = String(menuBox.description || "").trim();
        menuBox.createdAt = menuBox.createdAt || nowIso();
        menuBox.updatedAt = menuBox.updatedAt || menuBox.createdAt;
    });
}

function ensureAdminUser(data) {
    let admin = data.users.find((user) => user.username.toLowerCase() === DEFAULT_ADMIN_USERNAME.toLowerCase());
    if (!admin) {
        const hashed = hashPassword(DEFAULT_ADMIN_PASSWORD);
        admin = {
            id: createId("user"),
            username: DEFAULT_ADMIN_USERNAME,
            role: "admin",
            points: 0,
            passwordHash: hashed.hash,
            passwordSalt: hashed.salt,
            passwordIterations: hashed.iterations,
            passwordKeyLength: hashed.keyLength,
            passwordDigest: hashed.digest,
            createdAt: nowIso(),
            updatedAt: nowIso()
        };
        data.users.push(admin);
        return;
    }

    admin.role = "admin";
    admin.points = Math.max(0, Math.floor(Number(admin.points) || 0));
    admin.createdAt = admin.createdAt || nowIso();
    admin.updatedAt = admin.updatedAt || admin.createdAt;
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    });
    res.end(JSON.stringify(payload, null, 2));
}

function notFound(res) {
    sendJson(res, 404, { error: "Not found" });
}

function badRequest(res, message) {
    sendJson(res, 400, { error: message });
}

function unauthorized(res, message = "Unauthorized") {
    sendJson(res, 401, { error: message });
}

function forbidden(res, message = "Forbidden") {
    sendJson(res, 403, { error: message });
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let raw = "";
        req.on("data", (chunk) => {
            raw += chunk;
            if (raw.length > 1024 * 1024) {
                reject(new Error("Body too large"));
            }
        });
        req.on("end", () => {
            if (!raw) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(raw));
            } catch (error) {
                reject(new Error("Invalid JSON body"));
            }
        });
        req.on("error", reject);
    });
}

function getTokenFromRequest(req) {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
        return "";
    }
    return header.slice("Bearer ".length).trim();
}

function getSessionUser(req, data) {
    const token = getTokenFromRequest(req);
    if (!token) {
        return null;
    }

    const session = data.sessions.find((entry) => entry.token === token);
    if (!session) {
        return null;
    }

    return data.users.find((user) => user.id === session.userId) || null;
}

function sanitizeUser(user) {
    return {
        id: user.id,
        username: user.username,
        role: user.role,
        points: user.points,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
    };
}

function sanitizeScore(score, data) {
    const user = data.users.find((entry) => entry.id === score.userId);
    return {
        id: score.id,
        userId: score.userId,
        username: user ? user.username : "Unknown",
        value: score.value,
        note: score.note,
        status: score.status,
        createdAt: score.createdAt,
        reviewedAt: score.reviewedAt || null
    };
}

function sanitizeChallenge(challenge, data) {
    const creator = data.users.find((entry) => entry.id === challenge.createdByUserId);
    return {
        id: challenge.id,
        title: challenge.title,
        description: challenge.description,
        status: challenge.status,
        createdAt: challenge.createdAt,
        createdBy: creator ? creator.username : "Unknown",
        reviewedAt: challenge.reviewedAt || null
    };
}

function sanitizeChallengeSubmission(submission, data) {
    const user = data.users.find((entry) => entry.id === submission.userId);
    const challenge = data.challenges.find((entry) => entry.id === submission.challengeId);
    return {
        id: submission.id,
        challengeId: submission.challengeId,
        challengeTitle: challenge ? challenge.title : "Unknown",
        userId: submission.userId,
        username: user ? user.username : "Unknown",
        content: submission.content,
        status: submission.status,
        pointsAwarded: submission.pointsAwarded || 0,
        createdAt: submission.createdAt,
        reviewedAt: submission.reviewedAt || null
    };
}

function sanitizeMenuBox(menuBox) {
    return {
        id: menuBox.id,
        title: menuBox.title,
        description: menuBox.description,
        createdAt: menuBox.createdAt,
        updatedAt: menuBox.updatedAt
    };
}

function requireUser(res, user) {
    if (!user) {
        unauthorized(res);
        return false;
    }
    return true;
}

function requireAdmin(res, user) {
    if (!user) {
        unauthorized(res);
        return false;
    }
    if (user.role !== "admin") {
        forbidden(res);
        return false;
    }
    return true;
}

async function handleRegister(req, res, data) {
    const body = await parseBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (username.length < 3) {
        badRequest(res, "Username must be at least 3 characters.");
        return;
    }

    if (username.length > AUTH_TEXT_LIMIT || password.length > AUTH_TEXT_LIMIT) {
        badRequest(res, `Username and password must be ${AUTH_TEXT_LIMIT} characters or less.`);
        return;
    }

    if (password.length < 8) {
        badRequest(res, "Password must be at least 8 characters.");
        return;
    }

    const exists = data.users.some((user) => user.username.toLowerCase() === username.toLowerCase());
    if (exists) {
        badRequest(res, "Username already exists.");
        return;
    }

    const hashed = hashPassword(password);
    const user = {
        id: createId("user"),
        username,
        role: "user",
        points: 0,
        passwordHash: hashed.hash,
        passwordSalt: hashed.salt,
        passwordIterations: hashed.iterations,
        passwordKeyLength: hashed.keyLength,
        passwordDigest: hashed.digest,
        createdAt: nowIso(),
        updatedAt: nowIso()
    };

    const token = randomToken();
    data.users.push(user);
    data.sessions.push({
        id: createId("session"),
        token,
        userId: user.id,
        createdAt: nowIso()
    });
    saveData(data);

    sendJson(res, 201, {
        token,
        user: sanitizeUser(user)
    });
}

async function handleLogin(req, res, data) {
    const body = await parseBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (username.length > AUTH_TEXT_LIMIT || password.length > AUTH_TEXT_LIMIT) {
        badRequest(res, `Username and password must be ${AUTH_TEXT_LIMIT} characters or less.`);
        return;
    }

    const user = data.users.find((entry) => entry.username.toLowerCase() === username);

    if (!user || !verifyPassword(password, user)) {
        unauthorized(res, "Wrong username or password.");
        return;
    }

    const token = randomToken();
    data.sessions.push({
        id: createId("session"),
        token,
        userId: user.id,
        createdAt: nowIso()
    });
    saveData(data);

    sendJson(res, 200, {
        token,
        user: sanitizeUser(user)
    });
}

async function handleLogout(req, res, data) {
    const token = getTokenFromRequest(req);
    data.sessions = data.sessions.filter((session) => session.token !== token);
    saveData(data);
    sendJson(res, 200, { ok: true });
}

async function handleCreateChallenge(req, res, data, user) {
    if (!requireUser(res, user)) {
        return;
    }

    const body = await parseBody(req);
    const title = String(body.title || "").trim();
    const description = String(body.description || "").trim();

    if (!title || !description) {
        badRequest(res, "Title and description are required.");
        return;
    }

    const challenge = {
        id: createId("challenge"),
        title,
        description,
        status: user.role === "admin" ? "approved" : "pending",
        createdByUserId: user.id,
        createdAt: nowIso(),
        reviewedAt: user.role === "admin" ? nowIso() : null
    };

    data.challenges.push(challenge);
    saveData(data);
    sendJson(res, 201, { challenge: sanitizeChallenge(challenge, data) });
}

async function handleDeleteChallenge(res, data, user, challengeId) {
    if (!requireAdmin(res, user)) {
        return;
    }

    const challengeIndex = data.challenges.findIndex((entry) => entry.id === challengeId);
    if (challengeIndex === -1) {
        notFound(res);
        return;
    }

    const [removedChallenge] = data.challenges.splice(challengeIndex, 1);
    data.challengeSubmissions = data.challengeSubmissions.filter((submission) => submission.challengeId !== challengeId);
    saveData(data);
    sendJson(res, 200, { challenge: sanitizeChallenge(removedChallenge, data), ok: true });
}

async function handleChallengeSubmission(req, res, data, user, challengeId) {
    if (!requireUser(res, user)) {
        return;
    }

    const challenge = data.challenges.find((entry) => entry.id === challengeId);
    if (!challenge) {
        notFound(res);
        return;
    }

    if (challenge.status !== "approved" && user.role !== "admin") {
        forbidden(res, "Challenge is not open for submissions.");
        return;
    }

    const body = await parseBody(req);
    const content = String(body.content || "").trim();
    if (!content) {
        badRequest(res, "Submission content is required.");
        return;
    }

    const submission = {
        id: createId("challengeSubmission"),
        challengeId,
        userId: user.id,
        content,
        status: "pending",
        pointsAwarded: 0,
        createdAt: nowIso(),
        reviewedAt: null
    };

    data.challengeSubmissions.push(submission);
    saveData(data);
    sendJson(res, 201, { submission: sanitizeChallengeSubmission(submission, data) });
}

async function handleScoreSubmission(req, res, data, user) {
    if (!requireUser(res, user)) {
        return;
    }

    const body = await parseBody(req);
    const value = Math.floor(Number(body.value));
    const note = String(body.note || "").trim();

    if (!Number.isFinite(value) || value <= 0) {
        badRequest(res, "Score value must be greater than 0.");
        return;
    }

    const score = {
        id: createId("score"),
        userId: user.id,
        value,
        note,
        status: "pending",
        createdAt: nowIso(),
        reviewedAt: null
    };

    data.scores.push(score);
    saveData(data);
    sendJson(res, 201, { score: sanitizeScore(score, data) });
}

async function handleAdminAddPoints(req, res, data, user, userId) {
    if (!requireAdmin(res, user)) {
        return;
    }

    const body = await parseBody(req);
    const amount = Math.floor(Number(body.amount));
    if (!Number.isFinite(amount) || amount === 0) {
        badRequest(res, "Amount must be a non-zero integer.");
        return;
    }

    const target = data.users.find((entry) => entry.id === userId);
    if (!target) {
        notFound(res);
        return;
    }

    target.points = Math.max(0, target.points + amount);
    target.updatedAt = nowIso();
    saveData(data);
    sendJson(res, 200, { user: sanitizeUser(target) });
}

async function handleAdminApproveScore(res, data, user, scoreId, approved) {
    if (!requireAdmin(res, user)) {
        return;
    }

    const score = data.scores.find((entry) => entry.id === scoreId);
    if (!score) {
        notFound(res);
        return;
    }

    if (score.status !== "pending") {
        badRequest(res, "Score has already been reviewed.");
        return;
    }

    score.status = approved ? "approved" : "rejected";
    score.reviewedAt = nowIso();

    if (approved) {
        const target = data.users.find((entry) => entry.id === score.userId);
        if (target) {
            target.points += score.value;
            target.updatedAt = nowIso();
        }
    }

    saveData(data);
    sendJson(res, 200, { score: sanitizeScore(score, data) });
}

async function handleAdminReviewChallenge(res, data, user, challengeId, approved) {
    if (!requireAdmin(res, user)) {
        return;
    }

    const challenge = data.challenges.find((entry) => entry.id === challengeId);
    if (!challenge) {
        notFound(res);
        return;
    }

    if (challenge.status !== "pending") {
        badRequest(res, "Challenge has already been reviewed.");
        return;
    }

    challenge.status = approved ? "approved" : "rejected";
    challenge.reviewedAt = nowIso();
    saveData(data);
    sendJson(res, 200, { challenge: sanitizeChallenge(challenge, data) });
}

async function handleAdminReviewChallengeSubmission(req, res, data, user, submissionId, approved) {
    if (!requireAdmin(res, user)) {
        return;
    }

    const submission = data.challengeSubmissions.find((entry) => entry.id === submissionId);
    if (!submission) {
        notFound(res);
        return;
    }

    if (submission.status !== "pending") {
        badRequest(res, "Challenge submission has already been reviewed.");
        return;
    }

    let pointsAwarded = 0;
    if (approved) {
        const body = await parseBody(req);
        pointsAwarded = Math.max(0, Math.floor(Number(body.pointsAwarded) || 0));
    }

    submission.status = approved ? "approved" : "rejected";
    submission.pointsAwarded = pointsAwarded;
    submission.reviewedAt = nowIso();

    if (approved && pointsAwarded > 0) {
        const target = data.users.find((entry) => entry.id === submission.userId);
        if (target) {
            target.points += pointsAwarded;
            target.updatedAt = nowIso();
        }
    }

    saveData(data);
    sendJson(res, 200, { submission: sanitizeChallengeSubmission(submission, data) });
}

async function handleCreateMenuBox(req, res, data, user) {
    if (!requireAdmin(res, user)) {
        return;
    }

    const body = await parseBody(req);
    const title = String(body.title || "").trim();
    const description = String(body.description || "").trim();

    if (!title) {
        badRequest(res, "Menu box title is required.");
        return;
    }

    const menuBox = {
        id: createId("menuBox"),
        title,
        description,
        createdAt: nowIso(),
        updatedAt: nowIso()
    };

    data.menuBoxes.push(menuBox);
    saveData(data);
    sendJson(res, 201, { menuBox: sanitizeMenuBox(menuBox) });
}

async function handleUpdateMenuBox(req, res, data, user, menuBoxId) {
    if (!requireAdmin(res, user)) {
        return;
    }

    const menuBox = data.menuBoxes.find((entry) => entry.id === menuBoxId);
    if (!menuBox) {
        notFound(res);
        return;
    }

    const body = await parseBody(req);
    const title = body.title === undefined ? menuBox.title : String(body.title || "").trim();
    const description = body.description === undefined ? menuBox.description : String(body.description || "").trim();

    if (!title) {
        badRequest(res, "Menu box title is required.");
        return;
    }

    menuBox.title = title;
    menuBox.description = description;
    menuBox.updatedAt = nowIso();
    saveData(data);
    sendJson(res, 200, { menuBox: sanitizeMenuBox(menuBox) });
}

async function handleDeleteMenuBox(res, data, user, menuBoxId) {
    if (!requireAdmin(res, user)) {
        return;
    }

    const menuBoxIndex = data.menuBoxes.findIndex((entry) => entry.id === menuBoxId);
    if (menuBoxIndex === -1) {
        notFound(res);
        return;
    }

    const [removedMenuBox] = data.menuBoxes.splice(menuBoxIndex, 1);
    saveData(data);
    sendJson(res, 200, { menuBox: sanitizeMenuBox(removedMenuBox), ok: true });
}

async function requestHandler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const data = loadData();
    const user = getSessionUser(req, data);

    try {
        if (req.method === "GET" && pathname === "/api/health") {
            sendJson(res, 200, { ok: true, time: nowIso() });
            return;
        }

        if (req.method === "POST" && pathname === "/api/auth/register") {
            await handleRegister(req, res, data);
            return;
        }

        if (req.method === "POST" && pathname === "/api/auth/login") {
            await handleLogin(req, res, data);
            return;
        }

        if (req.method === "POST" && pathname === "/api/auth/logout") {
            await handleLogout(req, res, data);
            return;
        }

        if (req.method === "GET" && pathname === "/api/auth/me") {
            if (!requireUser(res, user)) {
                return;
            }
            sendJson(res, 200, { user: sanitizeUser(user) });
            return;
        }

        if (req.method === "GET" && pathname === "/api/leaderboard") {
            const leaderboard = [...data.users]
                .sort((first, second) => second.points - first.points || first.username.localeCompare(second.username))
                .map(sanitizeUser);
            sendJson(res, 200, { leaderboard });
            return;
        }

        if (req.method === "GET" && pathname === "/api/challenges") {
            let items = data.challenges;
            const status = url.searchParams.get("status");
            if (status && status !== "all") {
                items = items.filter((challenge) => challenge.status === status);
            } else if (!user || user.role !== "admin") {
                items = items.filter((challenge) => challenge.status === "approved");
            }
            sendJson(res, 200, { challenges: items.map((challenge) => sanitizeChallenge(challenge, data)) });
            return;
        }

        if (req.method === "POST" && pathname === "/api/challenges") {
            await handleCreateChallenge(req, res, data, user);
            return;
        }

        const challengeDeleteMatch = pathname.match(/^\/api\/admin\/challenges\/([^/]+)$/);
        if (req.method === "DELETE" && challengeDeleteMatch) {
            await handleDeleteChallenge(res, data, user, challengeDeleteMatch[1]);
            return;
        }

        const challengeSubmissionMatch = pathname.match(/^\/api\/challenges\/([^/]+)\/submissions$/);
        if (req.method === "POST" && challengeSubmissionMatch) {
            await handleChallengeSubmission(req, res, data, user, challengeSubmissionMatch[1]);
            return;
        }

        if (req.method === "GET" && pathname === "/api/menu-boxes") {
            const menuBoxes = data.menuBoxes.map(sanitizeMenuBox);
            sendJson(res, 200, { menuBoxes });
            return;
        }

        if (req.method === "GET" && pathname === "/api/admin/menu-boxes") {
            if (!requireAdmin(res, user)) {
                return;
            }
            sendJson(res, 200, { menuBoxes: data.menuBoxes.map(sanitizeMenuBox) });
            return;
        }

        if (req.method === "POST" && pathname === "/api/admin/menu-boxes") {
            await handleCreateMenuBox(req, res, data, user);
            return;
        }

        const menuBoxMatch = pathname.match(/^\/api\/admin\/menu-boxes\/([^/]+)$/);
        if (req.method === "PATCH" && menuBoxMatch) {
            await handleUpdateMenuBox(req, res, data, user, menuBoxMatch[1]);
            return;
        }

        if (req.method === "DELETE" && menuBoxMatch) {
            await handleDeleteMenuBox(res, data, user, menuBoxMatch[1]);
            return;
        }

        if (req.method === "GET" && pathname === "/api/scores") {
            if (!requireUser(res, user)) {
                return;
            }
            const scores = user.role === "admin"
                ? data.scores
                : data.scores.filter((score) => score.userId === user.id);
            sendJson(res, 200, { scores: scores.map((score) => sanitizeScore(score, data)) });
            return;
        }

        if (req.method === "POST" && pathname === "/api/scores") {
            await handleScoreSubmission(req, res, data, user);
            return;
        }

        if (req.method === "GET" && pathname === "/api/admin/users") {
            if (!requireAdmin(res, user)) {
                return;
            }
            sendJson(res, 200, { users: data.users.map(sanitizeUser) });
            return;
        }

        const adminUserPointsMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/points$/);
        if (req.method === "POST" && adminUserPointsMatch) {
            await handleAdminAddPoints(req, res, data, user, adminUserPointsMatch[1]);
            return;
        }

        if (req.method === "GET" && pathname === "/api/admin/scores/pending") {
            if (!requireAdmin(res, user)) {
                return;
            }
            const scores = data.scores.filter((score) => score.status === "pending").map((score) => sanitizeScore(score, data));
            sendJson(res, 200, { scores });
            return;
        }

        const adminScoreApproveMatch = pathname.match(/^\/api\/admin\/scores\/([^/]+)\/(approve|reject)$/);
        if (req.method === "POST" && adminScoreApproveMatch) {
            await handleAdminApproveScore(res, data, user, adminScoreApproveMatch[1], adminScoreApproveMatch[2] === "approve");
            return;
        }

        if (req.method === "GET" && pathname === "/api/admin/challenges/pending") {
            if (!requireAdmin(res, user)) {
                return;
            }
            const challenges = data.challenges
                .filter((challenge) => challenge.status === "pending")
                .map((challenge) => sanitizeChallenge(challenge, data));
            sendJson(res, 200, { challenges });
            return;
        }

        const adminChallengeReviewMatch = pathname.match(/^\/api\/admin\/challenges\/([^/]+)\/(approve|reject)$/);
        if (req.method === "POST" && adminChallengeReviewMatch) {
            await handleAdminReviewChallenge(res, data, user, adminChallengeReviewMatch[1], adminChallengeReviewMatch[2] === "approve");
            return;
        }

        if (req.method === "GET" && pathname === "/api/admin/challenge-submissions/pending") {
            if (!requireAdmin(res, user)) {
                return;
            }
            const submissions = data.challengeSubmissions
                .filter((submission) => submission.status === "pending")
                .map((submission) => sanitizeChallengeSubmission(submission, data));
            sendJson(res, 200, { submissions });
            return;
        }

        const adminChallengeSubmissionMatch = pathname.match(/^\/api\/admin\/challenge-submissions\/([^/]+)\/(approve|reject)$/);
        if (req.method === "POST" && adminChallengeSubmissionMatch) {
            await handleAdminReviewChallengeSubmission(
                req,
                res,
                data,
                user,
                adminChallengeSubmissionMatch[1],
                adminChallengeSubmissionMatch[2] === "approve"
            );
            return;
        }

        notFound(res);
    } catch (error) {
        if (error.message === "Invalid JSON body" || error.message === "Body too large") {
            badRequest(res, error.message);
            return;
        }

        sendJson(res, 500, {
            error: "Server error",
            detail: error.message
        });
    }
}

ensureDataFile();

http.createServer(requestHandler).listen(PORT, () => {
    console.log(`GD Skill Points backend running on http://localhost:${PORT}`);
});
