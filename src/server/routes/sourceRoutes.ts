/**
 * Data-source routes — register & sync whole Confluence spaces and Jira
 * projects. A "source" is a saved key; syncing it pulls every page /
 * issue into the reference store so the documentation pipeline can use
 * it as context.
 */

import { Router, type Request, type Response } from "express";

import { referenceStore } from "../store/referenceStore";
import { getStoredTokens } from "../auth/atlassianAuth";
import { syncConfluenceSpace, syncJiraProject } from "../../ingestion/sourceSync";

const router = Router();

// ── GET /api/sources ────────────────────────────────────────────────
router.get("/", (_req: Request, res: Response) => {
  res.json({
    confluenceSpaces: referenceStore.getSources("confluence-space"),
    jiraProjects: referenceStore.getSources("jira-project"),
    connected: !!getStoredTokens(),
  });
});

// ── POST /api/sources/confluence — register a space ─────────────────
router.post("/confluence", (req: Request, res: Response) => {
  const { key, name } = req.body as { key?: string; name?: string };
  const trimmed = (key ?? "").trim();
  if (!trimmed) {
    res.status(400).json({ error: "Space key zorunlu" });
    return;
  }
  const ref = referenceStore.addSource({
    kind: "confluence-space",
    key: trimmed,
    name: (name ?? "").trim() || trimmed,
  });
  res.json(ref);
});

// ── POST /api/sources/jira — register a project ─────────────────────
router.post("/jira", (req: Request, res: Response) => {
  const { key, name } = req.body as { key?: string; name?: string };
  const trimmed = (key ?? "").trim().toUpperCase();
  if (!trimmed) {
    res.status(400).json({ error: "Proje key zorunlu" });
    return;
  }
  const ref = referenceStore.addSource({
    kind: "jira-project",
    key: trimmed,
    name: (name ?? "").trim() || trimmed,
  });
  res.json(ref);
});

// ── DELETE /api/sources/:id ─────────────────────────────────────────
router.delete("/:id", (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const src = referenceStore.getSource(id);
  if (src?.kind === "jira-project") {
    referenceStore.removeJiraByProject(src.key);
  }
  referenceStore.removeSource(id);
  res.json({ ok: true });
});

// ── POST /api/sources/:id/sync — sync one source ────────────────────
router.post("/:id/sync", async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const src = referenceStore.getSource(id);
  if (!src) {
    res.status(404).json({ error: "Kaynak bulunamadı" });
    return;
  }
  if (!getStoredTokens()) {
    res.status(400).json({
      error: "Atlassian bağlantısı yok. Ayarlar'dan OAuth ile bağlanın.",
    });
    return;
  }

  try {
    const result =
      src.kind === "confluence-space"
        ? await syncConfluenceSpace(src.key)
        : await syncJiraProject(src.key);

    referenceStore.updateSource(id, {
      lastSync: new Date().toISOString(),
      itemCount: result.count,
    });

    res.json({ ok: true, count: result.count, log: result.log, source: referenceStore.getSource(id) });
  } catch (err) {
    const msg = (err as Error).message || "Senkronizasyon başarısız";
    console.error(`[source-sync] ${src.kind} ${src.key}:`, msg);
    res.status(400).json({ error: msg });
  }
});

// ── POST /api/sources/sync — sync every registered source ───────────
router.post("/sync", async (_req: Request, res: Response) => {
  if (!getStoredTokens()) {
    res.status(400).json({
      error: "Atlassian bağlantısı yok. Ayarlar'dan OAuth ile bağlanın.",
    });
    return;
  }

  const log: string[] = [];
  const errors: string[] = [];

  for (const src of referenceStore.getSources()) {
    try {
      const result =
        src.kind === "confluence-space"
          ? await syncConfluenceSpace(src.key)
          : await syncJiraProject(src.key);
      referenceStore.updateSource(src.id, {
        lastSync: new Date().toISOString(),
        itemCount: result.count,
      });
      log.push(...result.log);
    } catch (err) {
      const msg = `${src.key}: ${(err as Error).message}`;
      errors.push(msg);
      log.push(`✗ ${msg}`);
    }
  }

  res.json({ ok: errors.length === 0, log, errors });
});

export default router;
