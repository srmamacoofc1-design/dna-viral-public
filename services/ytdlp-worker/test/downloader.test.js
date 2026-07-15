import assert from "node:assert/strict";
import test from "node:test";
import { buildYtDlpArgs } from "../src/downloader.js";

test("argumentos do yt-dlp desativam playlist e mantêm URL em argv separado", () => {
  const url = "https://www.youtube.com/watch?v=vjqsNKq05iE";
  const args = buildYtDlpArgs({
    canonicalUrl: url,
    format: "best[height<=720][ext=mp4]/best[height<=720]/best",
    outputTemplate: "/tmp/job/video.%(ext)s",
    maxBytes: 300 * 1024 * 1024,
  });
  assert.ok(args.includes("--no-playlist"));
  assert.equal(args.at(-2), "--");
  assert.equal(args.at(-1), url);
  assert.equal(args[args.indexOf("--max-filesize") + 1], String(300 * 1024 * 1024));
  assert.equal(args[args.indexOf("--output") + 1], "/tmp/job/video.%(ext)s");
});
