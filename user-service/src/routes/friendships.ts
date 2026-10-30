import { Router } from "express";
import { asyncHandler } from "../http";
import { friendshipActor, listFriendRequests, listFriends, parseFriendPage, parseRequestDirection,
  removeFriend, respondToFriendRequest, sendFriendRequest } from "../friendships";

export function createFriendshipsRouter(): Router {
  const router = Router();
  router.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
  router.post("/request", asyncHandler(async (request, response) => {
    const actor = await friendshipActor(request);
    response.status(201).json(await sendFriendRequest(actor, request.body?.targetUserId));
  }));
  router.get("/requests", asyncHandler(async (request, response) => {
    const actor = await friendshipActor(request);
    response.json(await listFriendRequests(actor, parseRequestDirection(request.query.direction),
      parseFriendPage(request.query.page, request.query.pageSize)));
  }));
  router.get("/", asyncHandler(async (request, response) => {
    const actor = await friendshipActor(request);
    response.json(await listFriends(actor, parseFriendPage(request.query.page, request.query.pageSize)));
  }));
  for (const action of ["accept", "reject"] as const) {
    router.post(`/:requestId/${action}`, asyncHandler(async (request, response) => {
      const actor = await friendshipActor(request);
      response.json(await respondToFriendRequest(actor, request.params.requestId, action));
    }));
  }
  router.delete("/:friendUserId", asyncHandler(async (request, response) => {
    const actor = await friendshipActor(request);
    await removeFriend(actor, request.params.friendUserId);
    response.status(204).end();
  }));
  return router;
}
