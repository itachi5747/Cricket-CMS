# 🏏 Cricket CMS — API Reference

All requests go through the API Gateway at `http://localhost:8000`.

---

## Authentication

All endpoints except the auth public routes require a Bearer token:
```
Authorization: Bearer <accessToken>
```

Tokens expire in **15 minutes**. Use `/api/v1/auth/refresh` to get a new one.

---

## Auth Service — `/api/v1/auth`

| Method | Endpoint | Auth | Roles | Description |
|--------|----------|------|-------|-------------|
| POST | `/register` | ❌ | — | Create new account |
| POST | `/login` | ❌ | — | Login, get tokens |
| POST | `/refresh` | ❌ | — | Refresh access token |
| POST | `/logout` | ✅ | All | Logout, revoke token |
| POST | `/forgot-password` | ❌ | — | Request reset email |
| POST | `/reset-password` | ❌ | — | Set new password |

**POST /register**
```json
{
  "username": "john_doe",
  "email": "john@cricket.com",
  "password": "Test@1234!",
  "role": "Player",
  "fullName": "John Doe",
  "contactNumber": "+92-300-1234567"
}
```

**POST /login** → returns `accessToken`, `refreshToken`, `user`

---

## User Service — `/api/v1/users`

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/profile` | All | Own profile |
| PUT | `/profile` | All | Update own profile |
| GET | `/players` | Chairman, Coach, Selector | List all players |
| GET | `/players/:id` | Chairman, Coach, Selector | One player |
| POST | `/players` | Chairman | Add player |
| PUT | `/players/:id` | Chairman, Coach | Update player |
| GET | `/staff` | Chairman | List all staff |
| POST | `/staff` | Chairman | Add staff |
| PUT | `/staff/:id` | Chairman | Update staff |
| DELETE | `/staff/:id` | Chairman | Remove staff |
| GET | `/preferences` | All | Notification preferences |
| PUT | `/preferences` | All | Update preferences |

---

## Team Service — `/api/v1/teams`

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/` | All | List teams |
| POST | `/` | Chairman | Create team |
| GET | `/:teamId` | All | Team + players |
| PUT | `/:teamId` | Chairman, Coach | Update team |
| DELETE | `/:teamId` | Chairman | Delete team |
| POST | `/:teamId/players` | Chairman, Coach | Add players to team |
| DELETE | `/:teamId/players/:playerId` | Chairman, Coach | Remove player |
| GET | `/squads` | All | List squads |
| POST | `/squads` | Selector | Create squad |
| GET | `/squads/:squadId` | All | Squad details |
| PUT | `/squads/:squadId/finalize` | Selector | Submit for approval |
| PUT | `/squads/:squadId/approve` | Chairman | Approve/reject |

**Squad approval body:**
```json
{ "approved": true, "comments": "Well balanced" }
{ "approved": false, "rejectionReason": "Missing bowlers" }
```

---

## Match Service — `/api/v1/matches`

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/` | All | List matches (filter: status, matchType, from, to) |
| POST | `/` | Chairman, Coach | Schedule match |
| GET | `/:matchId` | All | Match + lineup + logistics |
| PUT | `/:matchId` | Chairman, Coach | Update (Scheduled only) |
| DELETE | `/:matchId` | Chairman | Cancel (Scheduled only) |
| POST | `/:matchId/lineup` | Coach | Set lineup |
| GET | `/:matchId/lineup` | All | Get lineup |
| PUT | `/:matchId/result` | Coach | Record result |
| POST | `/:matchId/logistics` | Chairman, Coach | Add logistics |
| GET | `/:matchId/logistics` | All | Get logistics |

**POST /result body:**
```json
{
  "status": "Completed",
  "result": "Win",
  "ourScore": "320/6",
  "opponentScore": "285/10"
}
```

---

## Performance Service — `/api/v1/performance`

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| POST | `/record` | Coach | Record player stats |
| GET | `/player/:playerId` | Coach, Chairman, Selector, Player | Performance history |
| GET | `/player/:playerId/stats` | All | Aggregated stats + milestones |
| GET | `/match/:matchId` | All | All performances for a match |
| GET | `/compare?playerIds=uuid1,uuid2` | Coach, Chairman, Selector | Side-by-side comparison |

**POST /record body:**
```json
{
  "playerId": "uuid",
  "matchId": "uuid",
  "matchDate": "2026-06-15",
  "matchType": "ODI",
  "opponent": "Australia",
  "batting": { "runs": 85, "ballsFaced": 95, "fours": 8, "sixes": 2, "dismissalType": "Caught", "position": 1 },
  "bowling": { "overs": 0, "wickets": 0, "runsConceded": 0 },
  "fielding": { "catches": 1, "runOuts": 0, "stumpings": 0 },
  "rating": 8,
  "coachNotes": "Excellent innings"
}
```

---

## Financial Service — `/api/v1/financial`

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/budget` | Chairman, Accountant | Current budget overview |
| POST | `/budget` | Chairman | Create fiscal year budget |
| GET | `/sponsorships` | Chairman, Accountant | List sponsorships |
| POST | `/sponsorships` | Accountant | Add sponsorship |
| PUT | `/sponsorships/:id` | Accountant | Update sponsorship |
| DELETE | `/sponsorships/:id` | Chairman | Terminate sponsorship |
| POST | `/salaries/process` | Accountant | Process salary payment |
| GET | `/salaries` | Chairman, Accountant, Player(own) | Salary history |
| GET | `/expenses` | Chairman, Accountant | List expenses |
| POST | `/expenses` | Chairman, Accountant | Record expense |
| PUT | `/expenses/:id/approve` | Chairman | Approve/reject expense |
| GET | `/reports/summary` | Chairman, Accountant | Financial summary |
| GET | `/transactions` | Chairman, Accountant | Audit trail |

---

## Notification Service — `/api/v1/notifications`

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/` | All | Own notifications (filter: read, category) |
| PUT | `/read-all` | All | Mark all as read |
| PUT | `/:notificationId/read` | All | Mark one as read |
| GET | `/preferences` | All | Get preferences |
| PUT | `/preferences` | All | Update preferences |

---

## File Service — `/api/v1/files`

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| POST | `/upload` | All | Upload file (multipart/form-data) |
| GET | `/:fileId` | All | File metadata + presigned download URL |
| DELETE | `/:fileId` | Uploader or Chairman | Delete file |
| GET | `/entity/:type/:entityId` | All | Files for an entity |
| POST | `/reports/generate` | Chairman, Accountant, Coach | Async PDF generation |
| GET | `/reports/:reportId/status` | All | Poll report status |
| GET | `/reports` | All | Own report history |

**POST /upload** — multipart/form-data:
```
file:               [binary]
fileType:           image | document | report
relatedEntityType:  player | match | team | expense | general
relatedEntityId:    uuid (optional)
description:        string (optional)
isPublic:           false
```

---

## Attendance Service — `/api/v1/attendance`

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/sessions` | All | List sessions (filter: sessionType, from, to) |
| POST | `/sessions` | Coach | Create session |
| GET | `/sessions/:sessionId` | All | Session + attendance list |
| PUT | `/sessions/:sessionId` | Coach | Update (before marking only) |
| POST | `/sessions/:sessionId/mark` | Coach | Bulk mark attendance |
| GET | `/sessions/:sessionId/attendance` | All | Attendance for session |
| GET | `/player/:playerId` | Coach, Chairman, Player(own) | Player attendance history |
| GET | `/summary?month=YYYY-MM` | Coach, Chairman | Monthly summary all players |

**POST /mark body:**
```json
{
  "attendanceRecords": [
    { "playerId": "uuid", "status": "Present", "arrivalTime": "09:00" },
    { "playerId": "uuid", "status": "Late",    "arrivalTime": "09:15", "notes": "Traffic" },
    { "playerId": "uuid", "status": "Absent" },
    { "playerId": "uuid", "status": "Excused", "notes": "Medical" }
  ]
}
```

---

## Response Format

All endpoints return the same shape:

**Success:**
```json
{
  "success": true,
  "message": "Description of what happened",
  "data": { ... }
}
```

**Paginated:**
```json
{
  "success": true,
  "message": "...",
  "data": [...],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalRecords": 48,
    "limit": 10,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

**Error:**
```json
{
  "success": false,
  "message": "Human-readable error description",
  "errors": [
    { "field": "email", "message": "must be a valid email address" }
  ]
}
```

---

## HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 202 | Accepted (async operation started) |
| 400 | Bad request (business rule violation) |
| 401 | Unauthorized (missing/expired/invalid token) |
| 403 | Forbidden (authenticated but wrong role) |
| 404 | Resource not found |
| 409 | Conflict (duplicate resource) |
| 422 | Validation failed (field-level errors in `errors` array) |
| 429 | Rate limit exceeded |
| 503 | Service temporarily unavailable |

---

## Rate Limits

| Endpoint group | Limit |
|----------------|-------|
| Auth endpoints | 10 requests/minute per IP |
| File uploads | 20 requests/minute per user |
| All other | 100 requests/minute per user |

Rate limit headers on every response:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1715000060
```
