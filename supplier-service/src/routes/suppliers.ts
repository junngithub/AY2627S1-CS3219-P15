import { Router, Request, Response } from "express";
import { prisma } from "../db";

const router = Router();

function isValidTimeFormat(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

// POST /api/v1/supplier — create a listing (status defaults to "pending")
router.post("/", async (req: Request, res: Response) => {
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

  try {
    const supplier = await prisma.supplier.create({
      data: {
        name, building, floor, locationDescription, latitude, longitude, startingTime, closingTime,
        categories: {
          connectOrCreate: (categories || []).map((catName: string) => ({
            where: { name: catName },
            create: { name: catName },
          })),
        },
      },
      include: { categories: true },
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
// NOTE: no auth check yet — needs to call User Service to verify admin role before this is real
router.get("/admin", async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;

  const suppliers = await prisma.supplier.findMany({
    where: status ? { status: status as any } : {},
    include: { categories: true },
  });

  res.json(suppliers);
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

// PATCH /api/v1/supplier/:id/status — admin only, update status
// NOTE: no auth check yet, no audit log table yet (F1.3.1 wants timestamp+admin logged)
router.patch("/:id/status", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid supplier id" });

  const { status } = req.body;
  if (!["pending", "approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status value" });
  }

  try {
    const supplier = await prisma.supplier.update({
      where: { id },
      data: { status },
    });
    res.json(supplier);
  } catch (err) {
    res.status(404).json({ error: "Supplier not found" });
  }
});

export default router;