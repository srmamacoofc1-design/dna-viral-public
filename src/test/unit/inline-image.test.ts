import { describe, expect, it } from "vitest";
import {
  imageBytesToBase64,
  readInlineImage,
} from "../../../supabase/functions/_shared/inline-image";

function jpeg(size = 1_200): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
}

describe("inline image safety", () => {
  it("accepts a bounded image using its real signature", async () => {
    const bytes = jpeg();
    const image = await readInlineImage(new Response(bytes, {
      headers: { "content-type": "text/plain" },
    }));
    expect(image.mimeType).toBe("image/jpeg");
    expect(image.bytes).toHaveLength(bytes.length);
    expect(imageBytesToBase64(image.bytes)).toBeTruthy();
  });

  it("rejects a declared payload above the cap before buffering", async () => {
    const response = new Response(jpeg(), {
      headers: { "content-length": "1300" },
    });
    await expect(readInlineImage(response, 1_250)).rejects.toThrow("excede o limite");
  });

  it("rejects content whose bytes are not a supported image", async () => {
    await expect(readInlineImage(new Response(new Uint8Array(1_200))))
      .rejects.toThrow("não é JPEG, PNG ou WebP");
  });
});
