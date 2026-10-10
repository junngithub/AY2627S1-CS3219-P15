import express from "express";
import suppliersRouter from "./routes/suppliers";

const app = express();
app.use(express.json());
app.use("/api/v1/supplier", suppliersRouter);

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => console.log(`Supplier service running on port ${PORT}`));