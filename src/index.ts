import express from "express";
import cors from "cors";
import { json } from "express";
import { extractRouter } from "./extractRoute";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(json());

app.use("/api", extractRouter);

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});

