# API reference

Base URL: `/api`. JSON in, JSON out. Import [`postman/MaintainIQ.postman_collection.json`](../postman/MaintainIQ.postman_collection.json) to try every endpoint.

## Conventions

**Authentication:** `Authorization: Bearer <token>` from `/api/auth/login` or `/api/auth/register`. Tokens are JWTs (HS256) that expire after `JWT_EXPIRES_IN` (default 8 h). The user is re-read on every request, so a deactivated account or a role change takes effect immediately.

**Success**

```json
{ "data": { ... }, "meta": { "count": 12 } }
```

**Error**

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Validation failed",
             "details": [{ "field": "kwh", "message": "kwh must be at least 0" }] } }
```

| Status | When |
|---|---|
| 200 / 201 / 204 | OK / created / deleted |
| 400 `VALIDATION_ERROR` | Bad body, bad query parameter, non-numeric or non-positive `:id`, unknown foreign key |
| 400 `INVALID_JSON` | Body is not valid JSON |
| 401 `UNAUTHORIZED` | Missing, malformed, forged or expired token; deactivated account; wrong login |
| 403 `FORBIDDEN` | Logged in, but the role or production line does not allow it |
| 403 `DEMO_PROTECTED` | Public demo only (`DEMO_MODE=true`): changing a seeded demo account, deleting a seeded record, or using the reserved `@maintainiq.demo` email domain |
| 404 `NOT_FOUND` | Record or route does not exist |
| 409 `CONFLICT` | Duplicate (email, asset tag, reading for the same day), record still referenced, invalid state change (closing a closed order) |
| 413 | Body larger than 100 kB |
| 429 `RATE_LIMITED` | Too many failed logins (10 per 15 min) or registrations (10 per hour) from one IP. `RateLimit` and `RateLimit-Policy` headers show the limit |
| 500 `INTERNAL_ERROR` | Unexpected; details are logged on the server, not sent in production |

Unknown fields in a body are ignored (a client cannot set `role_id`, `closed_at` or similar by adding them).

**Scoping:** operators only see and act on machines, work orders, downtime, energy readings and notes for **their own production line**. Supervisors see everything.

## Endpoints

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/health` | public | `{status, database}`, 503 if MySQL is unreachable |
| GET | `/public/production-lines` | public | id, code, name only (for the sign-up form) |
| GET | `/public/demo` | public | `{ enabled: false }`, or with `DEMO_MODE=true`: `{ enabled, password, accounts }` for the login page (the demo password is deliberately public) |
| **Auth** | | | |
| POST | `/auth/register` | public | `fullName, email, password (8–72), productionLineId` → always an **operator**. Rate limited: 10 attempts per IP per hour |
| POST | `/auth/login` | public | `email, password` → `{ token, user }`; same 401 message for unknown email and wrong password. Rate limited: 10 **failed** attempts per IP per 15 min (successful logins are not counted) |
| GET | `/auth/me` | any | current user |
| **Machines** | | | |
| GET | `/machines?status=&lineId=&search=` | any (scoped) | includes line name and open work order count |
| GET | `/machines/:id` | any (scoped) | 403 for another line |
| POST | `/machines` | supervisor | `productionLineId, assetTag, name, machineType, ratedPowerKw`, optional `manufacturer, status, installedOn` |
| PATCH | `/machines/:id` | supervisor | any subset of the fields above |
| PATCH | `/machines/:id/status` | any (scoped) | `{ status }` |
| DELETE | `/machines/:id` | supervisor | 409 while it has history |
| **Work orders** | | | |
| GET | `/work-orders?status=&priority=&machineId=&mine=true` | any (scoped) | open first, then by priority |
| GET | `/work-orders/:id` | any (scoped) | includes `notes[]` |
| POST | `/work-orders` | any (scoped) | `machineId, title`, optional `description, orderType, priority, dueDate`; `assignedTo` supervisor only |
| PATCH | `/work-orders/:id` | supervisor | `title, description, orderType, priority, dueDate` |
| POST | `/work-orders/:id/assign` | supervisor | `{ assignedTo }`; 409 if closed |
| POST | `/work-orders/:id/start` | assignee or supervisor | status → `in_progress` |
| POST | `/work-orders/:id/close` | supervisor | optional `{ resolution }` saved as a note in the same transaction |
| DELETE | `/work-orders/:id` | supervisor | notes are deleted by cascade |
| GET | `/work-orders/:id/notes` | any (scoped) | |
| POST | `/work-orders/:id/notes` | any (scoped) | `{ note }`; operators cannot add to closed orders |
| GET | `/notes?limit=&search=` | any (scoped) | latest notes across work orders |
| **Downtime** | | | |
| GET | `/downtime?machineId=&from=&to=&ongoing=true&limit=` | any (scoped) | `duration_minutes` is computed in SQL |
| GET | `/downtime/:id` | any (scoped) | |
| POST | `/downtime` | any (scoped) | `machineId, reasonCategory, startedAt`, optional `endedAt, description, workOrderId` |
| PATCH | `/downtime/:id/end` | reporter or supervisor | optional `{ endedAt }`, default now |
| DELETE | `/downtime/:id` | supervisor | |
| **Energy** | | | |
| GET | `/energy?machineId=&from=&to=&limit=` | any (scoped) | |
| GET | `/energy/daily?days=30` | any (scoped) | total kWh per day (GROUP BY) |
| POST | `/energy` | any (scoped) | `machineId, readingDate, kwh`; no future dates; 409 for a second reading that day |
| DELETE | `/energy/:id` | supervisor | |
| **Reports** | | | |
| GET | `/reports/summary` | any (scoped) | dashboard KPIs |
| GET | `/reports/machine-work-orders` | supervisor | JOIN machines ↔ work orders |
| GET | `/reports/monthly-downtime?months=6` | supervisor | GROUP BY month |
| GET | `/reports/monthly-energy?months=6` | supervisor | per line per month |
| GET | `/reports/above-average-downtime` | supervisor | subquery + HAVING |
| GET | `/reports/maintenance-workload` | supervisor | per person |
| GET | `/reports/downtime-by-reason?months=6` | supervisor | GROUP BY reason |
| **Production lines** | | | |
| GET | `/production-lines`, `/production-lines/:id` | any | with machine counts |
| POST / PATCH / DELETE | `/production-lines[/:id]` | supervisor | delete → 409 while machines exist |
| **Users** | | | |
| GET | `/users`, `/users/:id` | supervisor | never returns password hashes |
| POST | `/users` | supervisor | `fullName, email, password, role`, `productionLineId` required for operators |
| PATCH | `/users/:id` | supervisor | `fullName, role, productionLineId, isActive`; cannot deactivate or demote yourself |

## Examples

```bash
# Log in and keep the token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"operator@maintainiq.demo","password":"<SEED_PASSWORD>"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).data.token")

# Raise a maintenance request
curl -X POST http://localhost:3000/api/work-orders -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"machineId":1,"title":"Hydraulic hose leaking","priority":"high"}'

# An operator asking for a supervisor report -> 403
curl -i http://localhost:3000/api/reports/monthly-energy -H "Authorization: Bearer $TOKEN"
```
