# GD Skill Points Backend

Simple Node backend for player accounts, scores, challenges, main-menu boxes, and admin actions.

## What it does

- Creates and logs in users
- Hashes passwords with PBKDF2
- Stores sessions with bearer tokens
- Tracks points on user accounts
- Accepts score submissions
- Supports challenge creation and challenge submissions
- Stores main-menu boxes for the home page
- Enforces admin-only approval and point changes on the backend

## Storage

This version uses a JSON file instead of a real database so it stays easy to edit early on.

- Data file: `backend/data/app-data.json`
- The file is created automatically on first run
- A default admin account is also created automatically on first run

## Default admin

- Username: `Bab9104`
- Password: `BabHtmlfileLol124`

You can override those with environment variables before starting:

- `GD_ADMIN_USERNAME`
- `GD_ADMIN_PASSWORD`
- `PORT`

## Run

1. Install Node.js on the machine if it is not already installed.
2. Open a terminal in `C:\Users\bbhom\Downloads\GD Skill Points\backend`
3. Run `npm start`

The API starts on `http://localhost:3000` by default.

## Auth

Login and register return a bearer token.

Send it like this:

`Authorization: Bearer YOUR_TOKEN`

## Main routes

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/leaderboard`
- `GET /api/challenges`
- `POST /api/challenges`
- `POST /api/challenges/:challengeId/submissions`
- `GET /api/menu-boxes`
- `GET /api/scores`
- `POST /api/scores`
- `GET /api/admin/users`
- `POST /api/admin/users/:userId/points`
- `GET /api/admin/menu-boxes`
- `POST /api/admin/menu-boxes`
- `PATCH /api/admin/menu-boxes/:menuBoxId`
- `DELETE /api/admin/menu-boxes/:menuBoxId`
- `GET /api/admin/scores/pending`
- `POST /api/admin/scores/:scoreId/approve`
- `POST /api/admin/scores/:scoreId/reject`
- `GET /api/admin/challenges/pending`
- `DELETE /api/admin/challenges/:challengeId`
- `POST /api/admin/challenges/:challengeId/approve`
- `POST /api/admin/challenges/:challengeId/reject`
- `GET /api/admin/challenge-submissions/pending`
- `POST /api/admin/challenge-submissions/:submissionId/approve`
- `POST /api/admin/challenge-submissions/:submissionId/reject`

## Notes

- This is a clean starter backend, not a finished production deployment.
- It is designed so the JSON store can later be swapped for SQLite, Postgres, or another database.
- The current frontend still uses localStorage, so the next step after this is wiring the frontend pages to these API routes.
