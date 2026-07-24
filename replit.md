# ArkPet — Pet Daycare SaaS

## Overview

A full-stack multi-tenant SaaS platform for managing pet daycare centers (creches). Built with React + Vite frontend and Express backend with PostgreSQL.

## Recent Features (April 2026)
- **Chat unread badge**: bottom-nav chat icon shows real-time unread message count; pet chips in Chat page also show per-pet unread counts; polling every 8-15s; mark-as-read on select
- **Staff nav**: "Reservas" link added to staff role sidebar and bottom-nav
- **Pet creation tutor flow**: modal has "Existente"/"Novo" toggle — admins can select existing tutor from dropdown OR create a new tutor account inline (temp password shown on success)
- **Vaccine certificate photo**: camera/file upload on vaccine form; photo stored in `receiptUrl`; thumbnail shown on vaccine card with lightbox viewer
- **Walks in pet overview**: OverviewTab shows "Últimos Passeios" section with last 4 walks (duration, staff, status)
- **Notification routing**: service worker `notificationclick` now routes to `/pets/:id`, `/chat?pet=id`, `/bookings`, `/staff` based on notification type + petId
- **Bookings mobile card**: status badge now appears before type badge in mobile card view
- **Financial Module (July 2026)**: Added `tutor_credits` for prepaid daycare packages. Rebuilt invoice checkout to store detailed consumable items (joining `catalogueItemsTable` for explicit names) instead of generic IDs. Fixed `expenses/:id/pay` schema mismatch to correctly record `expenseId` and handle `req.body.paymentMethod` safely. Added "Detalhes" modal in tutor invoice view.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/petdaycare) — dark glassmorphism luxury UI
- **API framework**: Express 5 (artifacts/api-server)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Auth**: Custom JWT-like token in localStorage (Bearer header injection via custom-fetch.ts)
- **UI libraries**: Tailwind CSS, lucide-react, framer-motion, recharts, qrcode.react

## Architecture

### Multi-Tenant Design
- Every pet, booking, task, etc. has a `crecheId` field
- Firewall enforced at API route level based on user's `crecheId`
- 4 roles: `master_admin`, `creche_admin`, `staff`, `tutor`

### RBAC
- **Master Admin**: Access all creches, create/manage creches, see all users
- **Creche Admin**: Manage their creche, staff, pets, bookings
- **Staff**: View/complete tasks, log walks, post timeline events
- **Tutor**: View their own pets' timeline, bookings, chat

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   │   └── src/
│   │       ├── lib/auth.ts              # Token generation/verification
│   │       ├── middlewares/authenticate.ts  # Auth middleware + RBAC
│   │       └── routes/                  # auth, creches, pets, bookings, tasks, chat, users
│   └── petdaycare/         # React+Vite frontend (served at /)
│       └── src/
│           ├── hooks/use-auth.tsx       # Auth context (token in localStorage)
│           ├── components/layout/       # Sidebar, Header, AppLayout
│           ├── components/ui/           # Button, Card, Badge, Modal, Tabs
│           └── pages/                   # login, dashboard, pets, bookings, staff, admin
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks (+ Bearer token injection in custom-fetch.ts)
│   ├── api-zod/            # Generated Zod schemas
│   └── db/                 # Drizzle ORM schema + DB connection
│       └── src/schema/
│           ├── users.ts, creches.ts, pets.ts
│           ├── medical.ts (vaccines, medications)
│           ├── bookings.ts, tasks.ts
│           ├── timeline.ts, walks.ts, chat.ts
```

## Demo Accounts (all use password: `password`)

| Role | Email |
|------|-------|
| Master Admin | master@petdaycare.com |
| Creche Admin | ana@petparadise.com.br |
| Staff | bruno@petparadise.com.br |
| Tutor | tutor@petparadise.com.br |

## Key Features

- Pet digital profiles with vaccination records, medications, feeding + walk schedules
- Booking system for day use and lodging (check-in/check-out, tutor "I'm on my way" button)
- Staff task dashboard with daily checklists by type (feeding/medication/walk/grooming)
- Instagram-style pet timeline with photo upload (gallery + camera mode), emoji event badges
- Walk tracking with start/end times (creche-level view for all pets)
- Internal chat between tutor and creche
- QR Code per pet — staff scanner page using camera, tutor can download QR for collar
- Push notifications: task reminders (5 min before), "on the way" tutor alerts
- Cron job for automated task push reminders (node-cron, runs every minute)
- RBAC-aware UI: staff sees settings read-only, tutor can't edit booking status
- Creche admin user management (scoped to their creche)
- Master admin panel for multi-creche management

## API Routes

All routes prefixed with `/api`:
- `POST /auth/login`, `POST /auth/register`, `GET /auth/me`, `POST /auth/logout`
- `GET|POST /creches`, `GET|PUT /creches/:id`, `GET /creches/:id/stats`
- `GET|POST /creches/:id/staff`
- `GET|POST /creches/:id/pets`, `GET|PUT /creches/:id/pets/:petId`
- `GET /creches/:id/pets/by-qr/:token` — QR lookup for staff scanner
- `GET|POST /creches/:id/pets/:petId/vaccines`
- `GET|POST /creches/:id/pets/:petId/medications`, `POST .../administer`
- `GET|POST /creches/:id/pets/:petId/timeline`
- `GET /creches/:id/walks`, `POST /creches/:id/walks`, `PUT /creches/:id/walks/:walkId/end`
- `GET|POST /creches/:id/bookings`, `GET|PUT /creches/:id/bookings/:bookingId`
- `POST /creches/:id/bookings/:bookingId/checkin`, `.../checkout`, `.../on-the-way`
- `GET|POST /creches/:id/tasks`, `POST .../tasks/:taskId/complete`
- `GET|POST /creches/:id/chat`
- `GET /users`, `GET|PUT /users/:id`, `GET /users/by-creche/:crecheId`

## Development

```bash
# API server
pnpm --filter @workspace/api-server run dev

# Frontend
pnpm --filter @workspace/petdaycare run dev

# Codegen (after OpenAPI changes)
pnpm --filter @workspace/api-spec run codegen

# DB push
pnpm --filter @workspace/db run push
```
