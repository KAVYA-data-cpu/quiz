# Deploy WEB WIZARD on Vercel (free) with Turso (free database)

## 1. Create the database (Turso)
1. Sign up at turso.tech. Create a database (any name, nearest region).
2. Copy the database URL (looks like libsql://name-user.turso.io).
3. Create a token for it (Database -> Create Token) and copy it.

## 2. Put the project on GitHub
Create a private repo, upload everything inside the web-wizard folder (package.json, server.js, vercel.json, api/, public/ at the top level).

## 3. Import into Vercel
1. Sign up at vercel.com with GitHub. Add New -> Project -> pick the repo.
2. Framework Preset: Other. Leave build settings empty.
3. Add Environment Variables:
   - TURSO_DATABASE_URL = the libsql:// URL
   - TURSO_AUTH_TOKEN = the token
   - SESSION_SECRET = long random text (40+ characters)
   - ADMIN_PASS = your own admin password (username stays kavya)
   - TEAM_COUNT = 60  (creates 01..40; or TEAMS = 01,02,05,... for an exact list)
4. Deploy. Open the .vercel.app link (HTTPS is automatic).

## 4. Test, then clean up
Log in as 01 / wizard01 on a phone and laptop, take a quiz, check the admin score, then use Delete on test teams.

Participant passwords are "wizard" + team number. If you change TEAM_COUNT/TEAMS later, new teams are added on the next request; existing teams are untouched.
