function normalizeEvidenceWord(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function evidenceTokens(value: string): Array<{ normalized: string; start: number; end: number }> {
  return [...String(value || "").matchAll(/[\p{L}\p{N}]+/gu)].map(match => ({
    normalized: normalizeEvidenceWord(match[0]),
    start: match.index || 0,
    end: (match.index || 0) + match[0].length,
  }));
}

/**
 * Localiza o CTA como uma sequencia contigua de palavras em um bloco falado e
 * devolve o recorte literal daquele bloco. Assim, parafrases, titulos legados e
 * texto alucinado nunca sao persistidos como evidencia verbal.
 */
export function groundCtaText(
  candidate: unknown,
  blocks: any[],
  preferredBlockId?: unknown,
): { block: any; text: string } | null {
  const candidateTokens = evidenceTokens(String(candidate || ""));
  if (candidateTokens.length === 0) return null;
  const candidateWords = candidateTokens.map(token => token.normalized);
  const orderedBlocks = [...blocks].sort((left, right) => {
    const leftPreferred = left?.id === preferredBlockId ? 0 : 1;
    const rightPreferred = right?.id === preferredBlockId ? 0 : 1;
    return leftPreferred - rightPreferred;
  });

  for (const block of orderedBlocks) {
    const text = String(block?.texto || "");
    const tokens = evidenceTokens(text);
    for (let start = 0; start <= tokens.length - candidateWords.length; start++) {
      const matches = candidateWords.every((word, offset) => tokens[start + offset]?.normalized === word);
      if (!matches) continue;
      return {
        block,
        text: text.slice(tokens[start].start, tokens[start + candidateWords.length - 1].end),
      };
    }
  }
  return null;
}
