---
name: Chat tutor-centric refactor
description: Architecture of the refactored chat system — conversations per tutor, pet as optional tag.
---

## Architecture
- **Conversations** are per-tutor (not per-pet). Each tutor has exactly one conversation thread with the creche.
- **Pet tag** (`petId`, optional) on individual messages lets staff/tutors flag which pet a message is about.
- **Orphan messages** (old rows with `tutorId IS NULL`) are excluded from all queries via `isNotNull(chatMessages.tutorId)`.

## Key fields (chat_messages table)
- `tutorId integer` — conversation owner (NOT NULL for new messages; NULLable for old orphan rows)
- `petId integer` — optional tag, nullable
- `petName` — denormalized in query JOIN, not stored

## Backend endpoints (artifacts/api-server/src/routes/chat.ts)
- `GET /conversations` — one row per tutor, last message preview, unread count
- `GET /` params: `tutorId` + `cursor` (pagination by id ASC)
- `POST /` body: `{ tutorId, petId?, content, mediaUrl? }`
- `GET /unread` — returns `{ total, byTutor: { [tutorId]: count } }`
- `POST /mark-read` body: `{ tutorId }`

## Frontend (artifacts/petdaycare/src/pages/chat/index.tsx)
- **Tela A**: conversation list (tutors), search by name/pet, unread badge
- **Tela B**: messages with pet chip, load-older pagination, pet picker in input
- **Tutor role**: skips Tela A, goes directly to own conversation (`selectedTutorId = user.id`)
- **Deep-link**: `?tutor=X` opens conversation directly (used by push notifications)

## Push notifications
- SW `resolveTargetPath`: `type === "chat"` → `/chat?tutor=${data.tutorId}`
- App.tsx invalidates all `/chat` queries + `["chat-unread"]` on chat push

**Why:** Per-tutor chat is more natural for daycare (tutors don't want to see separate threads per pet), while still allowing staff to tag which pet a message concerns.
