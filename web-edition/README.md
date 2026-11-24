# Noteriv web experiment

This branch packages the browser app and its server from the
[covuaduongsinh fork](https://github.com/covuaduongsinh/Noteriv/tree/5f3ac81b93f51a7b8c10f94b691b2ac6d471f408) in a separate npm workspace.
The server has its own vault database. Its Git sync can connect to a repository
you configure. Start with a disposable vault or branch when testing a sync
against the native apps.

## Local setup

Run these commands from `web-edition/` with Node.js 22 or newer.

```sh
npm ci
cp web/.env.example web/.env.local
cp web/server/.env.example web/server/.env
```

Set a development Postgres password and pass it to the dev Compose project.
The database and Redis ports bind to loopback.

```sh
POSTGRES_PASSWORD=your-dev-password docker compose -f web/infra/docker-compose.dev.yml up -d postgres redis
```

In `web/server/.env`, set `DATABASE_URL` to
`postgresql://noteriv:your-dev-password@127.0.0.1:55432/noteriv`,
`REDIS_URL` to `redis://127.0.0.1:56379`, and `NODE_ENV=development`.
Generate distinct secrets for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
and `ENCRYPTION_KEY` with `openssl rand -hex 32`. For a loopback-only
development instance you can set `REGISTRATION_MODE=open` to create an account.

```sh
cd web/server
npm ci
npm run prisma:generate
npm run prisma:deploy
npm run dev
```

In another terminal, run `npm run dev:web` from `web-edition/`, then open
[localhost:3457](http://localhost:3457). Start `npm run dev:worker` from
`web/server/` to process sync jobs and `npm run dev:collab` for collaboration.
The optional object storage service is available in the dev Compose file.

Run `npm run typecheck`, `npm test`, `npm test -w noteriv-web`, and
`npm run build:web` from `web-edition/`. The [end-to-end guide](e2e/README.md)
covers testing with the database and browser. The upstream production Compose
file is included under `web/infra/` and needs site-specific values for deployment.
