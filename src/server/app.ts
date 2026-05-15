import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";

import discoveryRoutes from "./routes/discoveryRoutes";
import jobRoutes from "./routes/jobRoutes";
import documentRoutes from "./routes/documentRoutes";
import confluenceRoutes from "./routes/confluenceRoutes";
import exportRoutes from "./routes/exportRoutes";
import settingsRoutes from "./routes/settingsRoutes";

const app = express();
const PORT = process.env["PORT"] || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Serve screenshots as static files
app.use(
  "/screenshots",
  express.static(path.join(process.cwd(), "data", "screenshots"))
);

// API routes
app.use("/api/discovery", discoveryRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/confluence", confluenceRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/settings", settingsRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Serve React build in production
const clientBuild = path.join(
  process.cwd(),
  "client",
  "dist"
);

if (fs.existsSync(clientBuild)) {
  app.use(express.static(clientBuild));

  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(clientBuild, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.json({
      message:
        "Documentation Agent API. Run `cd client && npm run dev` for the UI.",
    });
  });
}

app.listen(PORT, () => {
  console.log(`\n Documentation Agent Server`);
  console.log(`  API  → http://localhost:${PORT}/api`);
  console.log(`  UI   → http://localhost:${PORT} (production build)`);
  console.log(`\n  For development: cd client && npm run dev`);
});

export default app;
