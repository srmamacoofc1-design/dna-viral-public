import assert from "node:assert/strict";
import test from "node:test";
import { parseYouTubeVideoUrl, YouTubeUrlError } from "../src/youtube.js";

const ID = "vjqsNKq05iE";

test("aceita somente formatos de URL de vídeo individual e canonicaliza", () => {
  for (const url of [
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
  ]) {
    assert.deepEqual(parseYouTubeVideoUrl(url), {
      videoId: ID,
      canonicalUrl: `https://www.youtube.com/watch?v=${ID}`,
    });
  }
});

test("recusa canal e playlist, inclusive vídeo com parâmetro list", () => {
  for (const url of [
    "https://www.youtube.com/@Benji_Curioso",
    "https://www.youtube.com/channel/UC123",
    "https://www.youtube.com/playlist?list=PL123",
    `https://www.youtube.com/watch?v=${ID}&list=PL123`,
    `https://youtu.be/${ID}?list=PL123`,
  ]) {
    assert.throws(
      () => parseYouTubeVideoUrl(url),
      (error) => error instanceof YouTubeUrlError && error.code === "YOUTUBE_COLLECTION_NOT_A_VIDEO",
    );
  }
});

test("recusa hosts parecidos, credenciais e IDs inválidos", () => {
  for (const url of [
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `https://evil.youtube.com/watch?v=${ID}`,
    `https://usuario:senha@youtube.com/watch?v=${ID}`,
    "https://www.youtube.com/shorts/curto",
    `ftp://www.youtube.com/watch?v=${ID}`,
  ]) {
    assert.throws(() => parseYouTubeVideoUrl(url), YouTubeUrlError);
  }
});
