import { describe, expect, it } from "vitest";
import { groundCtaText } from "../../../supabase/functions/_shared/cta-evidence";

const blocks = [
  { id: "opening", texto: "Você precisa ver isso até o final!", tempo_inicio: 0 },
  { id: "middle", texto: "Ele abriu a porta e encontrou uma caixa.", tempo_inicio: 4 },
];

describe("CTA spoken evidence grounding", () => {
  it("recupera o recorte literal da fala mesmo com diferenca de acento e caixa", () => {
    const grounded = groundCtaText("voce precisa ver isso", blocks, "opening");
    expect(grounded?.block.id).toBe("opening");
    expect(grounded?.text).toBe("Você precisa ver isso");
  });

  it("rejeita parafrase ou texto alucinado que nao aparece na fala", () => {
    expect(groundCtaText("não saia deste vídeo", blocks, "opening")).toBeNull();
  });

  it("rejeita palavras reais quando nao formam uma sequencia contigua", () => {
    expect(groundCtaText("você ver final", blocks, "opening")).toBeNull();
  });

  it("encontra o bloco real mesmo quando o id sugerido pela IA esta errado", () => {
    const grounded = groundCtaText("abriu a porta", blocks, "opening");
    expect(grounded?.block.id).toBe("middle");
    expect(grounded?.text).toBe("abriu a porta");
  });
});
