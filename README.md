# PSS Tryouts System

Backend, automation, and admin dashboard for Peace Soccer School's Fall 2026 tryouts campaign.

The **public landing page** lives elsewhere — at `peacesoccerschool.com/tryouts`. This Next.js app handles:

- **POST `/api/leads`** — public, CORS-enabled signup endpoint. The landing page form posts here.
- **Email confirmation** — sends a warm welcome email from `tryouts@peacesoccerschool.com` with a `.ics` invite attached.
- **WhatsApp automation** — two-way: receives inbound messages via webhook, marks parents as confirmed, and sends template reminders (T-3, T-1, day-of).
- **Admin dashboard** at `/admin` — password-protected, dark theme, manage leads / fire manual sends / view activity log.

---

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS — dark theme, PSS red (`#DC2626`) accent
- Supabase (`leads` + `lead_activities` tables)
- Nodemailer over Gmail SMTP
- `ics` package for calendar invites
- WhatsApp Business Cloud API via direct `fetch` calls to Meta Graph

---

## Quickstart

```bash
npm install
cp .env.local.example .env.local
# fill in the values
npm run dev
```

Open <http://localhost:3000/admin> and sign in with `ADMIN_PASSWORD`.

---

## Environment variables

See `.env.local.example` for the full list. Plug in:

| Var | What it's for |
|-----|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key (unused server-side but referenced) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side service role — bypasses RLS |
| `SMTP_HOST` / `SMTP_PORT` | `smtp.gmail.com` / `465` |
| `SMTP_USER` | `tryouts@peacesoccerschool.com` |
| `SMTP_PASS` | Gmail **App Password** (not your account password) |
| `WHATSAPP_ACCESS_TOKEN` | Permanent system-user access token from Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | The Phone Number ID from Meta Business Manager |
| `WHATSAPP_VERIFY_TOKEN` | Any random string — must match what you put in Meta's webhook config |
| `ADMIN_PASSWORD` | Anything — the dashboard prompts for it |
| `TRYOUT_DATE` | Default: `2026-08-15` |
| `TRYOUT_TIME` | Default: `09:00` |
| `TRYOUT_LOCATION` | Default: `Bliss Fields, Rehoboth MA` |
| `CRON_SECRET` *(optional)* | Bearer token Vercel cron sends; if unset, `x-vercel-cron: 1` is trusted |

---

## Database schema

The `leads` table already exists. The app also references a `lead_activities` table for the activity log on the lead detail page — create it if you want activity logging:

```sql
create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  channel text not null check (channel in ('email','whatsapp','system')),
  kind text not null,
  detail text,
  success boolean not null default true
);

create index if not exists lead_activities_lead_id_idx
  on public.lead_activities (lead_id, created_at desc);
```

The app also expects a `whatsapp_confirmed_at timestamptz` column on `leads`. If you don't have it yet:

```sql
alter table public.leads
  add column if not exists whatsapp_confirmed_at timestamptz;
```

Activity logging is **soft-fail** — if the table doesn't exist, the rest of the app still works.

---

## Endpoints

### `POST /api/leads`
Public. CORS allows any origin. Required JSON body:

```json
{
  "parent_name": "...",
  "player_name": "...",
  "player_age": 9,
  "parent_phone": "+1 508 555 1234",
  "parent_email": "parent@example.com",
  "whatsapp_opt_in": true
}
```

Returns `{ "success": true, "leadId": "<uuid>" }`. Welcome email is fired asynchronously — the response doesn't wait for SMTP.

### `GET /api/leads`
Admin-only. Auth via `x-admin-password` header.

### `PATCH /api/leads/:id`
Admin-only. Updates a whitelist of columns (`status`, `notes`, `whatsapp_confirmed`, etc.).

### `DELETE /api/leads/:id`
Admin-only.

### `POST /api/leads/:id/send`
Admin-only. Body: `{ "action": "welcome_email" | "welcome_whatsapp" | "reminder_whatsapp" }`.

### `GET /api/whatsapp/webhook`
Meta's verification handshake. Set the webhook URL in Meta Business Manager and use `WHATSAPP_VERIFY_TOKEN`.

### `POST /api/whatsapp/webhook`
Inbound messages. Matches by trailing 10 digits of phone, marks `whatsapp_confirmed = true`, fires the `pss_welcome` template.

### `GET /api/whatsapp/send-reminders`
Cron-triggered. Sends T-3, T-1, and day-of reminders based on `tryout_date`.

---

## Required WhatsApp templates

Create these approved templates in **Meta Business Manager → WhatsApp Manager → Message Templates**:

| Name | Body parameters |
|------|-----------------|
| `pss_welcome` | `{{1}}` parent name, `{{2}}` player name |
| `pss_reminder` | `{{1}}` parent name, `{{2}}` player name, `{{3}}` location |
| `pss_reminder_3day` | `{{1}}` parent, `{{2}}` player, `{{3}}` location |
| `pss_reminder_1day` | `{{1}}` parent, `{{2}}` player, `{{3}}` time, `{{4}}` location |
| `pss_reminder_today` | `{{1}}` parent, `{{2}}` player, `{{3}}` time, `{{4}}` location |

Language: `en_US` (change in `lib/whatsapp.ts` if needed).

---

## Cron

`vercel.json` is wired to run reminders **daily at 14:00 UTC** (≈ 10am EDT / 9am EST):

```json
{ "crons": [{ "path": "/api/whatsapp/send-reminders", "schedule": "0 14 * * *" }] }
```

For local testing:

```bash
curl "http://localhost:3000/api/whatsapp/send-reminders?password=$ADMIN_PASSWORD"
```

---

## Connecting the landing page

On `peacesoccerschool.com/tryouts`, point the form at:

```js
fetch("https://<this-app>.vercel.app/api/leads", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    parent_name, player_name, player_age,
    parent_phone, parent_email, whatsapp_opt_in
  })
});
```

CORS is `*` so this works from anywhere.

---

## Deploying

1. Push to a repo and import into Vercel.
2. Add all env vars in the Vercel project settings.
3. Vercel will auto-detect Next.js 14 and pick up `vercel.json` for the cron.
4. Configure the WhatsApp webhook URL in Meta to `https://<your-domain>/api/whatsapp/webhook` with your `WHATSAPP_VERIFY_TOKEN`.

---

## Project layout

```
app/
  layout.tsx              Root shell, dark theme
  page.tsx                Landing-page shortcut to /admin
  globals.css
  admin/
    page.tsx              Password gate + dashboard
    leads/[id]/page.tsx   Lead detail w/ manual sends, activity log
  api/
    leads/route.ts                       POST (public, CORS) + GET (admin)
    leads/[id]/route.ts                  GET / PATCH / DELETE
    leads/[id]/send/route.ts             POST manual send
    whatsapp/webhook/route.ts            GET verify + POST receive
    whatsapp/send-reminders/route.ts     GET (cron)

lib/
  supabase.ts   Service-role + anon clients, shared Lead type
  email.ts      sendWelcomeEmail() + .ics builder
  whatsapp.ts   sendWhatsAppTemplate() + normalizePhone()
  activity.ts   logActivity() — soft-fail event log
  auth.ts       constant-time admin password check
```
