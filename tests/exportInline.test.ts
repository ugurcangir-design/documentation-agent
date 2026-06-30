import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { inlineScreenshots } from "../src/server/routes/exportRoutes";

const shotsDir = path.join(process.cwd(), "data", "screenshots");
// 1x1 PNG (geçerli) — gömme testi için.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAAA2ttgAAAAASUVORK5CYII=";
const fileName = "__inline_test__shot.png";
const filePath = path.join(shotsDir, fileName);

afterAll(() => { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); });

describe("inlineScreenshots (PDF görsel gömme)", () => {
  it("/screenshots/<ad> img src'lerini base64 data-URI ile gömer", () => {
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(PNG_B64, "base64"));

    const html = `<img alt="Ana" src="/screenshots/${fileName}">`;
    const out = inlineScreenshots(html, shotsDir);

    expect(out).toContain("data:image/png;base64,");
    expect(out).not.toContain(`/screenshots/${fileName}`); // ham yol kalmadı
  });

  it("dosya yoksa referansı OLDUĞU GİBİ bırakır (kayıp yaratmaz)", () => {
    const html = `<img src="/screenshots/yok-boyle-dosya.png">`;
    expect(inlineScreenshots(html, shotsDir)).toBe(html);
  });

  it("path traversal güvenli — basename'e indirger", () => {
    const html = `<img src="/screenshots/../../etc/passwd">`;
    const out = inlineScreenshots(html, shotsDir);
    // passwd gömülmez; basename 'passwd' shotsDir'de yok → değişmez.
    expect(out).toBe(html);
  });
});
