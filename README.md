# personnel-fm-be

The MyFinance REST API: a backend for personal monthly finance management, built with Node.js, Express 5, TypeScript, MongoDB and Mongoose.

## Requirements

- Node.js 20 or later
- MongoDB running as a **replica set**. Atomic account transfers use multi-document transactions, which need one. Use MongoDB Atlas, or a local single-node replica set:

  ```bash
  brew tap mongodb/brew && brew install mongodb-community mongosh
  printf 'replication:\n  replSetName: rs0\n' >> /opt/homebrew/etc/mongod.conf
  brew services start mongodb/brew/mongodb-community
  mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})'
  ```

## Getting started

```bash
cp .env.example .env   # then adjust MONGO_URI / CORS_ORIGINS
npm install
npm run dev            # http://localhost:4000
```

- The health check is at `GET /api/v1/health`.
- Swagger UI is at `/api/docs`, and the raw OpenAPI JSON is at `/api/docs.json`.

## Scripts

| Script                                    | Purpose                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `npm run dev`                             | Start with hot reload (tsx)                                             |
| `npm run build` / `npm start`             | Compile to `dist/` and run                                              |
| `npm test`                                | Run the Jest + Supertest suite against an in-memory MongoDB replica set |
| `npm run test:coverage`                   | Run the tests with a coverage report                                    |
| `npm run lint` / `npm run typecheck`      | Run ESLint / the TypeScript checks                                      |
| `npm run format` / `npm run format:check` | Format with Prettier / check formatting                                 |

## Conventions

- **Paths:** every endpoint is versioned under `/api/v1`.
- **Responses:** success is `{ success: true, data, meta? }`, errors are `{ success: false, error: { code, message, details? } }`.
- **Layering:** each feature module in `src/modules/<feature>/` keeps routes, controllers, services, models and Zod schemas separate. Business logic lives in services, not controllers.
- **Validation and docs:** request validation uses Zod through `middleware/validate.ts`. The same schemas are registered with `docs/openapi.ts`, so Swagger stays in sync with what the API accepts.
- **Money:** amounts are stored as integer **paise** (₹1 = 100 paise), and floating-point maths is never used for totals.
- **Ownership:** every query is scoped to the authenticated user's ID.

## Authentication

- **Cookies:** sessions use three cookies.
  - `mf_access` is a short-lived JWT (HttpOnly).
  - `mf_refresh` is an opaque refresh token (HttpOnly, sent only to `/api/v1/auth`).
  - `mf_csrf` holds the CSRF token.

  Tokens are never returned in response bodies, so they can't end up in `localStorage`.

- **Refresh rotation:** each refresh token is stored as a SHA-256 hash in the `sessions` collection.
  - `POST /auth/refresh` revokes the presented token and issues its successor.
  - Replaying an already-rotated token more than 30 seconds later revokes the whole session family, on the assumption it was stolen.
  - Protected routes also check that the session is still active, so logout takes effect immediately.
- **CSRF:** the API uses the double-submit pattern. Clients call `GET /auth/csrf` and send the value as `X-CSRF-Token` on every POST/PUT/PATCH/DELETE, including login and register.
- **Passwords:** passwords are hashed with bcrypt (`BCRYPT_ROUNDS`, default 12) and limited to 72 bytes.
  - Login returns the same error for an unknown email as for a wrong password.
  - Password reset and change-password both revoke other sessions.
- **Password reset:** no mailer is configured yet, so `POST /auth/forgot-password` **logs the reset link** at warn level. Replace `modules/auth/passwordResetNotifier.ts` with a real mailer before production.
- **Cross-site deployment:** when the frontend and API are on different sites (Vercel + Render), set `COOKIE_SAMESITE=none` (cookies then become `Secure`) and add the frontend URL to `CORS_ORIGINS`.
