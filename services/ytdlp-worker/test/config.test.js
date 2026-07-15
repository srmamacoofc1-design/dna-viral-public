import assert from "node:assert/strict";
import test from "node:test";
import { HARD_MAX_VIDEO_MIB, loadConfig, MEBIBYTE } from "../src/config.js";

const TOKEN = "test-token-with-at-least-32-characters-long";

test("loadConfig aplica o teto rígido de 300 MiB", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    YTDLP_SERVICE_TOKEN: TOKEN,
    PUBLIC_BASE_URL: "https://worker.example",
    MAX_VIDEO_MIB: "300",
  });
  assert.equal(config.maxBytes, HARD_MAX_VIDEO_MIB * MEBIBYTE);
  assert.throws(() => loadConfig({
    NODE_ENV: "production",
    YTDLP_SERVICE_TOKEN: TOKEN,
    PUBLIC_BASE_URL: "https://worker.example",
    MAX_VIDEO_MIB: "301",
  }), /MAX_VIDEO_MIB/);
});

test("loadConfig exige token forte e HTTPS em produção", () => {
  assert.throws(() => loadConfig({
    NODE_ENV: "production",
    YTDLP_SERVICE_TOKEN: "curto",
    PUBLIC_BASE_URL: "https://worker.example",
  }), /32 caracteres/);
  assert.throws(() => loadConfig({
    NODE_ENV: "production",
    YTDLP_SERVICE_TOKEN: TOKEN,
    PUBLIC_BASE_URL: "http://worker.example",
  }), /HTTPS/);
  assert.throws(() => loadConfig({
    NODE_ENV: "production",
    YTDLP_SERVICE_TOKEN: TOKEN,
    PUBLIC_BASE_URL: "https://worker.example/prefixo",
  }), /sem caminho/);
});
