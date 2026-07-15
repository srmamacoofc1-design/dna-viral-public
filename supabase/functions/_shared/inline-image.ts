export const MAX_INLINE_IMAGE_BYTES = 12 * 1024 * 1024;

export interface InlineImage {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}

function declaredLength(response: Response): number | null {
  const raw = response.headers.get("content-length");
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function detectMime(bytes: Uint8Array): InlineImage["mimeType"] | null {
  if (bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

/** Reads an image with a hard memory/request cap and verifies its real signature. */
export async function readInlineImage(
  response: Response,
  maxBytes = MAX_INLINE_IMAGE_BYTES,
): Promise<InlineImage> {
  const length = declaredLength(response);
  if (length !== null && length > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Imagem excede o limite de ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
  }
  if (!response.body) throw new Error("Resposta da imagem não possui conteúdo.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Imagem excede o limite de ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (total < 1_000) throw new Error(`Imagem muito pequena (${total} bytes).`);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const mimeType = detectMime(bytes);
  if (!mimeType) throw new Error("Arquivo não é JPEG, PNG ou WebP válido.");
  return { bytes, mimeType };
}

export function imageBytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
