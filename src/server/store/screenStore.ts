import fs from "fs";
import path from "path";
import { writeJsonAtomic, readJsonSafe } from "./atomicJson";

export interface StoredScreenState {
  label: string;
  triggeredBy: string;
  screenshotPath: string;
}

export interface StoredScreen {
  url: string;
  path: string;
  title: string;
  screenshotPath: string;
  depth: number;
  parentPath?: string;
  discoveredAt: string;
  states?: StoredScreenState[];
}

const DB_PATH = path.join(
  process.cwd(),
  "data",
  "db",
  "screens.json"
);

function load(): StoredScreen[] {
  return readJsonSafe<StoredScreen[]>(DB_PATH, []);
}

function save(screens: StoredScreen[]): void {
  writeJsonAtomic(DB_PATH, screens);
}

export const screenStore = {
  getAll(): StoredScreen[] {
    return load();
  },

  getByPath(screenPath: string): StoredScreen | undefined {
    return load().find((s) => s.path === screenPath);
  },

  saveMany(screens: StoredScreen[]): void {
    save(screens);
  },

  toDiscoveredScreen(
    s: StoredScreen
  ): import("../../types/screen").DiscoveredScreen {
    const screenshotBase64 = fs.existsSync(s.screenshotPath)
      ? fs.readFileSync(s.screenshotPath).toString("base64")
      : "";

    const states = s.states?.map((st) => ({
      label: st.label,
      triggeredBy: st.triggeredBy,
      screenshotPath: st.screenshotPath,
      screenshotBase64: fs.existsSync(st.screenshotPath)
        ? fs.readFileSync(st.screenshotPath).toString("base64")
        : "",
    }));

    return {
      url: s.url,
      path: s.path,
      title: s.title,
      screenshotPath: s.screenshotPath,
      screenshotBase64,
      depth: s.depth,
      ...(s.parentPath !== undefined ? { parentPath: s.parentPath } : {}),
      ...(states && states.length > 0 ? { states } : {}),
    };
  },
};
