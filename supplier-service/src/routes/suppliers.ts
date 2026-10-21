import { Prisma, SupplierActionType } from "@prisma/client";
import { Router, Request, Response } from "express";
import { prisma } from "../db";
import { actorUserId, requireAdmin, requirePermitted } from "../gateway";

const router = Router();

function isValidTimeFormat(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

const STATUS_ACTION: Record<string, SupplierActionType> = {
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
};

function actor(req: Request, res: Response): string | undefined {
  const userId = actorUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in is required" });
    return undefined;
  }
  return userId;
}

// POST /api/v1/supplier — create a listing (status defaults to "pending")
router.post("/", requirePermitted, async (req: Request, res: Response) => {
  const { name, building, floor, locationDescription, latitude, longitude, startingTime, closingTime, categories } = req.body;

  if (typeof latitude !== "number" || typeof longitude !== "number" ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: "Invalid latitude/longitude" });
  }

  if (!isValidTimeFormat(startingTime) || !isValidTimeFormat(closingTime)) {
    return res.status(400).json({ error: "startingTime and closingTime must be in HH:MM 24-hour format" });
  }

  if (startingTime === closingTime) {
    return res.status(400).json({
      error: "startingTime and closingTime cannot be identical — use 00:00 and 23:59 for 24-hour operation",
    });
  }

  const userId = actor(req, res);
  if (!userId) return;

  try {
    const supplier = await prisma.$transaction(async (tx) => {
      const created = await tx.supplier.create({
        data: {
          name, building, floor, locationDescription, latitude, longitude, startingTime, closingTime,
          createdByUserId: userId,
          categories: {
            connectOrCreate: (categories || []).map((catName: string) => ({
              where: { name: catName },
              create: { name: catName },
            })),
          },
        },
        include: { categories: true },
      });
      await tx.supplierAction.create({
        data: {
          supplierId: created.id,
          supplierName: created.name,
          action: "created",
          actorUserId: userId,
        },
      });
      return created;
    });
    res.status(201).json(supplier);
  } catch (err) {
    res.status(500).json({ error: "Failed to create supplier" });
  }
});

// GET /api/v1/supplier — public search, approved only, filterable by one or more comma-separated categories, paginated
router.get("/", async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 100);
  const categoryParam = req.query.category as string | undefined;
  console.log("RAW categoryParam:", JSON.stringify(categoryParam));
  const categoryList = categoryParam ? categoryParam.split(",").map((c) => c.trim()) : undefined;
  console.log("PARSED categoryList:", categoryList);

  const suppliers = await prisma.supplier.findMany({
    where: {
      status: "approved",
      ...(categoryList ? { categories: { some: { name: { in: categoryList } } } } : {}),
    },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { categories: true },
  });

  res.json(suppliers);
});

// GET /api/v1/supplier/admin — admin only, all statuses, filterable by status
router.get("/admin", requireAdmin, async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;

  const suppliers = await prisma.supplier.findMany({
    where: status ? { status: status as any } : {},
    include: { categories: true },
  });

  res.json(suppliers);
});

// GET /api/v1/supplier/admin/activity — who created, edited, approved, or deleted a supplier
router.get("/admin/activity", requireAdmin, async (req: Request, res: Response) => {
  const supplierIdRaw = req.query.supplierId as string | undefined;
  let supplierId: number | undefined;
  if (supplierIdRaw !== undefined && supplierIdRaw !== "") {
    supplierId = parseInt(supplierIdRaw);
    if (isNaN(supplierId)) return res.status(400).json({ error: "Invalid supplier id" });
  }

  const actions = await prisma.supplierAction.findMany({
    where: supplierId === undefined ? {} : { supplierId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(actions);
});

// GET /api/v1/supplier/:id — single supplier lookup (used by Order Service)
router.get("/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid supplier id" });

  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: { categories: true },
  });

  if (!supplier) return res.status(404).json({ error: "Supplier not found" });
  res.json(supplier);
});

// PATCH /api/v1/supplier/:id — edit listing details. Status stays on PATCH /:id/status.
router.patch("/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid supplier id" });

  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Supplier not found" });

  const {
    name, building, floor, locationDescription, latitude, longitude,
    startingTime, closingTime, categories,
  } = req.body ?? {};

  const data: Prisma.SupplierUpdateInput = {};

  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name must be a non-empty string" });
    }
    data.name = name;
  }
  if (building !== undefined) data.building = building;
  if (floor !== undefined) data.floor = floor;
  if (locationDescription !== undefined) data.locationDescription = locationDescription;

  if (latitude !== undefined) {
    if (typeof latitude !== "number" || latitude < -90 || latitude > 90) {
      return res.status(400).json({ error: "Invalid latitude/longitude" });
    }
    data.latitude = latitude;
  }
  if (longitude !== undefined) {
    if (typeof longitude !== "number" || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: "Invalid latitude/longitude" });
    }
    data.longitude = longitude;
  }

  if (startingTime !== undefined || closingTime !== undefined) {
    const nextStart = startingTime ?? existing.startingTime;
    const nextEnd = closingTime ?? existing.closingTime;
    if (!isValidTimeFormat(nextStart) || !isValidTimeFormat(nextEnd)) {
      return res.status(400).json({ error: "startingTime and closingTime must be in HH:MM 24-hour format" });
    }
    if (nextStart === nextEnd) {
      return res.status(400).json({
        error: "startingTime and closingTime cannot be identical — use 00:00 and 23:59 for 24-hour operation",
      });
    }
    if (startingTime !== undefined) data.startingTime = startingTime;
    if (closingTime !== undefined) data.closingTime = closingTime;
  }

  if (categories !== undefined) {
    if (!Array.isArray(categories) || categories.some((cat) => typeof cat !== "string" || !cat.trim())) {
      return res.status(400).json({ error: "categories must be an array of non-empty strings" });
    }
    const records = await Promise.all(
      categories.map((catName: string) =>
        prisma.category.upsert({
          where: { name: catName },
          update: {},
          create: { name: catName },
        })
      )
    );
    data.categories = { set: records.map((cat) => ({ id: cat.id })) };
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "No supplier fields to update" });
  }

  const userId = actor(req, res);
  if (!userId) return;

  try {
    const supplier = await prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({
        where: { id },
        data,
        include: { categories: true },
      });
      await tx.supplierAction.create({
        data: {
          supplierId: updated.id,
          supplierName: updated.name,
          action: "edited",
          actorUserId: userId,
          detail: Object.keys(data).join(","),
        },
      });
      return updated;
    });
    res.json(supplier);
  } catch (err) {
    res.status(500).json({ error: "Failed to update supplier" });
  }
});

// DELETE /api/v1/supplier/:id — remove one supplier
router.delete("/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid supplier id" });

  const userId = actor(req, res);
  if (!userId) return;

  try {
    const supplier = await prisma.$transaction(async (tx) => {
      const existing = await tx.supplier.findUnique({
        where: { id },
        include: { categories: true },
      });
      if (!existing) return null;
      await tx.supplierAction.create({
        data: {
          supplierId: existing.id,
          supplierName: existing.name,
          action: "deleted",
          actorUserId: userId,
        },
      });
      await tx.supplier.delete({ where: { id } });
      return existing;
    });
    if (!supplier) return res.status(404).json({ error: "Supplier not found" });
    res.json(supplier);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete supplier" });
  }
});

// PATCH /api/v1/supplier/:id/status — admin only, update status and record who did it
router.patch("/:id/status", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid supplier id" });

  const { status } = req.body;
  const action = STATUS_ACTION[status];
  if (!action) {
    return res.status(400).json({ error: "Invalid status value" });
  }

  const userId = actor(req, res);
  if (!userId) return;

  try {
    const supplier = await prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({
        where: { id },
        data: { status },
      });
      await tx.supplierAction.create({
        data: {
          supplierId: updated.id,
          supplierName: updated.name,
          action,
          actorUserId: userId,
        },
      });
      return updated;
    });
    res.json(supplier);
  } catch (err) {
    res.status(404).json({ error: "Supplier not found" });
  }
});

export default router;