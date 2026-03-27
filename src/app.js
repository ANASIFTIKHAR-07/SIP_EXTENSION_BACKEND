import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

const app = express();

app.use(
  cors({
    credentials: true,
    origin: [
      process.env.CORS_ORIGIN,
      "http://localhost:5173",
      "https://localhost:5173",
    ],
  }),
);

app.use(cookieParser());
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ limit: "16kb", extended: true }));
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

// Routes for the Controllers

import userRoutes from "./routes/user.routes.js";
import extensionRoutes from "./routes/extension.routes.js";
import callRoutes from "./routes/call.routes.js";
import aiAgentRoutes from "./routes/aiagent.routes.js";
import rateLimitRoutes from "./routes/ratelimit.routes.js";

app.use("/api/v1/users", userRoutes);
app.use("/api/v1/sip", extensionRoutes);
app.use("/api/v1/calls", callRoutes);
app.use("/api/v1/ai-agents", aiAgentRoutes);
app.use("/api/v1/rate-limits", rateLimitRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

app.use((err, req, res, next) => {
  console.error(err); // optional logging
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    statusCode,
    success: false,
    message: err.message || "Internal Server Error",
    data: null,
  });
});

export { app };
