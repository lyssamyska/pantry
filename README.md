# Pantry

Personal meal-planning app: a 7-day dinner plan plus a grocery list that subtracts what's already in the pantry. Express + EJS + Postgres. Originally generated on Polsia; now fully self-hosted with no Polsia dependencies.

See `CLAUDE.md` for architecture and `reference/` for material to port.

## Run locally

```bash
npm install
```

```bash
DATABASE_URL=postgres://... SESSION_SECRET="$(openssl rand -base64 48)" npm start
```

Those two variables are all it needs. Migrations run on startup.

## Existing account from the Polsia era

Accounts created with emailed sign-in codes have no password yet. Set one:

```bash
DATABASE_URL=postgres://... npm run set-password -- you@example.com
```

## Run tests

```bash
npm test
```

No database needed.
