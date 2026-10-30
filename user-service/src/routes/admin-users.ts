import { Router } from "express";
import { changeUser, parseAdminChange, parseAdminSearch, requireAdministrator, searchUsers } from "../admin-users";
import { asyncHandler } from "../http";

export function createAdminUsersRouter(): Router {
  const router = Router();
  router.get("/search", asyncHandler(async (request, response) => {
    const actor = await requireAdministrator(request);
    response.set("Cache-Control", "no-store").json(await searchUsers(actor, parseAdminSearch(request.query.q, request.query.page)));
  }));
  for (const kind of ["role", "status"] as const) {
    router.post(`/:userId/${kind}`, asyncHandler(async (request, response) => {
      const actor = await requireAdministrator(request);
      response.set("Cache-Control", "no-store").json(await changeUser(actor, request.params.userId, parseAdminChange(kind, request.body)));
    }));
  }
  return router;
}
