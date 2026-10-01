# src/samples — throwaway data

Everything in this folder is fake. Nothing here came from a service, and none
of it should survive into the finished project.

It exists because the pages were built from mockups before the services they
depend on were written, and a screen with no data cannot be reviewed against
a mockup.

## What is in here

- `account.ts` — the demo signed-in user, and the credit balance and reserved
  figures shown in the nav bar.
- `openRequests.ts` — the courier task pool rows, and a stubbed `acceptRequest`
  that waits 700ms and then succeeds, except for one row that always reports a
  lost race so the conflict banner can be seen.
- `myRequests.ts` — the My requests rows and the total count.
- `orderDetail.ts` — request #1042 from the order detail mockups, plus a
  lookup that borrows its locations for rows opened from My requests.
- `myDeliveries.ts` — the My deliveries rows; the active ones share ids with
  `courierTasks.ts` so a row opens the matching task page.
- `courierTasks.ts` — task #1042 in its three drawn courier states, one id per
  state because nothing can advance an order yet.

## What is not in here

Types are real and live in `src/lib/orders.ts`. Formatting, validation, the
countdown hook, the HTTP client and the session module are all real code and
stay where they are. Only data and stubbed calls belong in this folder.

## Deleting it

When the services exist, delete the folder. The build will then fail in
exactly the places that still need a real call, which is the point — nothing
silently keeps serving invented rows.

The importers, as of 28 September 2026:

- `src/pages/BrowsePage.tsx` — pool rows and the accept stub
- `src/pages/MyRequestsPage.tsx` — request rows
- `src/pages/OrderDetailPage.tsx` — order lookup
- `src/pages/CourierTaskPage.tsx` — courier task lookup
- `src/pages/MyDeliveriesPage.tsx` — delivery rows
- `src/pages/NewRequestPage.tsx` — credit balance
- `src/components/layout/AppShell.tsx` — balance and reserved
- `src/auth/AuthProvider.tsx` — the demo user, used while `AUTH_ENABLED` is
  false in `src/lib/session.ts`
- `src/lib/adminUsers.ts` — the user management rows, used only while
  `AUTH_ENABLED` is false

