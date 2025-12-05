import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { json } from "express";
import rateLimit from "express-rate-limit";
import { extractRouter } from "./extractRoute";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Disable X-Powered-By header for security
app.disable("x-powered-by");

// CORS configuration - restrict to allowed origins
const allowedOrigins = [
  "https://drive-scraper.vercel.app",
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  })
);

app.use(json());

// Rate limiting for /api/extract endpoint
const extractLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 30, // 30 requests per minute
  message: {
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many requests, please try again later.",
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/extract", extractLimiter);
app.use("/api", extractRouter);

// Global error handler - sanitized output for production
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("[INTERNAL ERROR]", err);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Unexpected error occurred while processing request.",
    },
  });
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
