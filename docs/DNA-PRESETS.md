# Sistema de Presets DNA v3 — especificação portátil

> **Arquivo canônico:** `docs/DNA-PRESETS.md`
>
> Este documento descreve o contrato implementado no código atual. O DNA v3 transfere
> **estratégias mensuráveis** dos vídeos-base para um roteiro novo; textos, nomes,
> entidades e assuntos dos vídeos-base não são dados ao modelo como exemplos.

## 1. O que o DNA v3 faz

Um **Preset DNA** é um conjunto nomeado de vídeos já processados. Ao consolidar esse
conjunto, o sistema mede como cada parte dos roteiros virais foi construída e salva o
resultado em um pacote reutilizável:

```text
vídeos-base processados
        ↓
estratégias por bloco + ritmo + progressão + evidência visual
        ↓
Preset DNA v3 salvo no banco
        ↓
contrato aplicado e validado em um novo tema, roteiro ou vídeo
```

O objetivo é reproduzir a **engenharia narrativa**, não reproduzir o texto-fonte. Para
cada tipo de bloco (`hook`, `setup`, `desenvolvimento`, `tensao`, `revelacao`,
`payoff`, `transicao`, `loop`), o motor pode medir:

- padrão de abertura: pergunta, negação, alerta, promessa, descoberta, número,
  endereço direto, afirmação de choque ou afirmação comum;
- faixa e alvo de palavras e de frases;
- tamanho médio das frases e palavras por segundo;
- taxas de pergunta, exclamação, endereço direto e payoff retido;
- micro-revelações e marcadores de escalada por frase;
- emoção e intensidade dominantes;
- ações e emoções visuais agregadas;
- quantidade de vídeos distintos que sustentam a estratégia;
- sequência estrutural dominante do conjunto.

A consolidação também cria evidência por vídeo: engajamento, sequência de blocos,
assinatura do hook, progressão narrativa, microviradas, âncora visual e cobertura de
evidência. Isso impede que um único vídeo de alto engajamento represente sozinho todo
o preset.

## 2. O que o DNA v3 deliberadamente não faz

- Não injeta os ganchos reais, frases de impacto ou palavras ponderadas no prompt.
- Não pede ao modelo que parafraseie um roteiro da base.
- Não usa o assunto, personagens, nomes ou lugares dos vídeos-base como conteúdo do
  roteiro novo.
- Não cai silenciosamente para um roteiro genérico quando o preset está ausente,
  incompleto ou incompatível.
- Não garante desempenho viral. O contrato garante verificações de estrutura,
  evidência e anti-cópia no software; alcance e engajamento continuam dependendo do
  conteúdo, distribuição, edição, audiência e comportamento do modelo de IA.

Os textos reais ainda podem ficar armazenados no pacote como **evidência protegida**.
Eles são usados depois da geração apenas para detectar cópia literal; não são
renderizados no prompt do modelo. Para cada tipo de bloco, o pacote conserva no
máximo uma referência por vídeo-fonte, até **128 fontes distintas**. Presets com até
128 fontes precisam ter cobertura protegida completa em cada tipo obrigatório;
referências repetidas do mesmo vídeo não contam como novas fontes. Acima desse teto,
o guarda mantém as 128 fontes de maior engajamento daquele tipo para limitar o tamanho
persistido do contexto.

## 3. Pré-requisitos dos vídeos-base

Um vídeo só contribui para a consolidação quando está com `videos.status =
"completed"` e possui blocos narrativos extraídos. Para que o DNA visual seja real,
o processamento também precisa ter produzido evidência em `visual_block_analysis`.

O contrato v3 define `min_source_videos = 3`. A interface de criação ainda aceita
selecionar menos vídeos, mas um pacote com menos de três fontes falha na injeção e não
é usado para gerar. Na prática, use pelo menos três vídeos completos e, para maior
estabilidade estatística, uma amostra maior do mesmo formato editorial.

Qualidade de extração é registrada em quatro medidas:

- `video_coverage`: quantos vídeos selecionados contribuíram de fato;
- `text_strategy_coverage`: cobertura de blocos com texto;
- `visual_strategy_coverage`: cobertura de vídeos com evidência visual;
- `overall`: `20% vídeo + 50% texto + 30% visual`.

O pacote registra alertas quando há menos de três vídeos, cobertura textual abaixo de
80% ou cobertura visual abaixo de 80%. No modo vídeo há ainda uma trava operacional:
menos de **60% de cobertura visual na base DNA** interrompe a injeção.

O filtro de idioma aceita alvo `pt` ou `en` e reconhece textos em português, inglês e
espanhol para filtragem. A assinatura estrutural é aproveitável entre idiomas, mas
exemplos protegidos incompatíveis com o idioma-alvo não são selecionados como
referência textual.

## 4. Arquivos da implementação

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/dna-style-pack.ts` | Consolidação, perfis abstratos, qualidade, contrato, anti-cópia auxiliar e injeção no contexto |
| `src/lib/dna-presets.ts` | Criar, listar, reconsolidar e apagar presets em `dataset_cohort` |
| `src/components/VideoLibrary.tsx` | Seleção de vídeos e ação **Criar Preset DNA** |
| `src/components/VideoUploadForm.tsx` | Ingestão da Biblioteca por upload retomável ou lista de URLs, sem limite visível, processada em lotes internos |
| `src/components/script-engine/InputPanel.tsx` | Upload ou lista de URLs de vídeos operacionais, seleção da referência pronta, preset e Gancho Apelão |
| `src/lib/reference-link-queue.ts` | Estado, nomes seguros, idempotência e concorrência da fila de links de referência |
| `src/components/script-engine/ViralAgentReport.tsx` | Relatório do Escritor/Avaliador, auditor factual independente, gates, estimativas e trilha de revisões |
| `src/pages/app/UserGeneratePage.tsx` | Aplica o DNA no fluxo `/app` |
| `src/pages/dashboard/ScriptEnginePage.tsx` | Aplica o DNA no fluxo `/dashboard/script-engine` |
| `supabase/functions/assemble-script/index.ts` | Geração por bloco, prioridade visual, guarda anti-cópia e execução do loop Escritor/Avaliador |
| `supabase/functions/_shared/viral-review-loop.ts` | Separação de papéis, normalização, gates locais, máximo de ciclos e auditoria do loop |
| `supabase/functions/_shared/independent-narrative-auditor.ts` | Inventário autoritativo de microeventos, contexto visual, bijeção de IDs e auditoria independente de omissão, distorção, causalidade e fatos sem suporte |
| `supabase/functions/validate-script-against-dna/index.ts` | Validação crítica do contrato DNA v3 |
| `supabase/functions/revise-script-assembly/index.ts` | Regeneração pela mesma montagem estrita quando há revisão |
| `supabase/functions/promote-script-final/index.ts` | Bloqueia a promoção final quando o loop viral habilitado não foi aprovado |
| `supabase/functions/process-reference-video/index.ts` | Transcrição e análise visual reais do vídeo operacional |
| `supabase/functions/transcribe-video/index.ts` | Transcrição e análise visual multimodal dos vídeos da Biblioteca |
| `supabase/functions/download-video/index.ts` | Resolução e armazenamento de URLs de vídeos individuais |
| `docs/INGESTION-DEPLOYMENT.md` | Segredos, worker yt-dlp, funções a publicar e critérios de saúde |

## 5. Persistência do preset

O preset reutiliza `dataset_cohort` com `cohort_type = "dna_preset"`; o recurso DNA
em si não exige uma tabela nova. O formato abaixo é resumido, mas conserva os campos
relevantes do contrato atual:

```jsonc
{
  "cohort_name": "Preset Curiosidades",
  "cohort_type": "dna_preset",
  "video_ids": ["uuid-1", "uuid-2", "uuid-3"],
  "video_count": 3,
  "confidence_score": 100,
  "active": true,
  "rules_json": {
    "kind": "dna_preset",
    "target_lang": "pt",
    "consolidated_at": "2026-07-13T00:00:00.000Z",
    "style_pack": {
      "version": 3,
      "target_lang": "pt",
      "scope": "preset",
      "scope_video_ids": ["uuid-1", "uuid-2", "uuid-3"],
      "total_videos": 3,
      "dominant_sequence": "hook → desenvolvimento → tensao → payoff",
      "dominant_sequence_count": 2,
      "block_styles": [
        {
          "block_type": "hook",
          "examples": [
            {
              "text": "evidência protegida; nunca entra no prompt",
              "emotion": "curiosidade",
              "words": 8,
              "engagement_rate": 0.12,
              "video_id": "uuid-1",
              "strategy": { "opening_pattern": "shock_statement" }
            }
          ],
          "weighted_words": ["estatística protegida"],
          "impact_phrases": [],
          "dominant_emotion": "curiosidade",
          "avg_intensity": 4.2,
          "median_words": 8,
          "avg_words_per_second": 3.9,
          "strategy": {
            "source_video_count": 3,
            "dominant_opening_patterns": ["shock_statement"],
            "word_range": { "min": 5, "target": 8, "max": 12 },
            "sentence_range": { "min": 1, "target": 1, "max": 2 },
            "avg_sentence_words": 8,
            "question_rate": 0,
            "exclamation_rate": 0.33,
            "direct_address_rate": 0,
            "withheld_payoff_rate": 0.67,
            "micro_reveals_per_sentence": 0.5,
            "escalation_markers_per_sentence": 0.25,
            "dominant_visual_actions": ["ação agregada"],
            "dominant_visual_emotions": ["surpresa"],
            "strategy_instruction": "instrução estrutural derivada"
          }
        }
      ],
      "video_strategies": [],
      "strategy_contract": {
        "required_block_types": ["hook", "desenvolvimento", "payoff"],
        "min_source_videos": 3,
        "min_strategy_score": 0.82,
        "max_exact_ngram": 3,
        "max_content_similarity": 0.62,
        "fail_closed": true,
        "visual_first_required": true
      },
      "extraction_quality": {
        "video_coverage": 1,
        "text_strategy_coverage": 1,
        "visual_strategy_coverage": 1,
        "overall": 1,
        "warnings": []
      },
      "built_at": "2026-07-13T00:00:00.000Z"
    }
  }
}
```

`rules_json.style_pack` é cacheado. `rebuildDnaPreset(id)` reconsolida o pacote após
reprocessamento, correção de métricas ou mudança dos dados-base.

O hook com estratégia é sempre obrigatório para um pacote pronto. Entre
`hook`, `desenvolvimento` e `payoff`, o contrato inclui em
`required_block_types` os tipos que foram extraídos; qualquer tipo listado precisa de
perfil correspondente.

## 6. Injeção no contexto de geração

Depois que `build-complete-generation-context` cria o contexto, o front chama:

```ts
applyDnaStylePack(contextId, targetLang, { presetId, hookApelao })
```

Com `presetId`, a resolução é estrita: preset inexistente, sem vídeos ou sem pacote
consolidável retorna `injected: false`; não há fallback silencioso para a Base Global.
Sem `presetId`, a Base Global pode ser consolidada normalmente.

Antes de escrever o contexto, a injeção exige:

1. pelo menos três vídeos-fonte;
2. estratégia de hook;
3. contrato com `fail_closed = true`;
4. todos os perfis listados como obrigatórios;
5. evidência textual;
6. no modo vídeo, ao menos 60% de cobertura visual na base;
7. no modo vídeo, `topic_analysis` existente.

As instruções abstratas são inseridas nos canais já lidos pelo montador:

| Modo | Canal |
|---|---|
| tema | `context_payload.theme_constraints.usage_instructions[]` |
| transformar | `context_payload.transform_constraints.usage_instructions[]` |
| vídeo | `context_payload.video_reference_context.topic_analysis.semantic_alignment_rules.tone_guidance` |
| todos | `slot_sequence[].dna_strategy_ref` por tipo de bloco |

O v3 **não** preenche `slot_sequence[].vocab_ref` com vocabulário da base. Em
`generation_rules.style_pack`, ele persiste somente os perfis necessários ao
montador, o contrato, a qualidade, o preset ativo e as referências protegidas para o
guarda pós-geração.

Um contexto com DNA v3 pronto é idempotente para o mesmo preset e a mesma opção de
Gancho Apelão. Trocar preset ou essa opção em um contexto já injetado exige reconstruir
o contexto; a tentativa é recusada em vez de misturar dois DNAs.

## 7. Prioridade visual no modo vídeo

O vídeo novo enviado para geração é **conteúdo operacional**: ele fornece fatos,
ações, personagens e ordem dos acontecimentos. A base DNA fornece apenas a estratégia
narrativa.

O fluxo do modo vídeo é:

1. upload retomável para o Storage;
2. criação de `reference_videos` com estado de processamento;
3. transcrição real do áudio;
4. análise dos pixels do vídeo inteiro e extração de momentos visuais;
5. análise temática e pontos de ancoragem;
6. criação do contexto e injeção do DNA v3;
7. montagem e validação.

Novas referências ficam no bucket privado `reference-videos`, sempre sob
`reference/<user-id>/...`. Instalações atualizadas a partir da versão que usava o
bucket público `videos` devem executar o job administrativo idempotente
`migrate-legacy-reference-videos`: ele copia server-side, verifica o tamanho exato,
troca a linha e só então remove uma origem comprovadamente exclusiva. O bucket da
Biblioteca Viral continua público enquanto seus consumidores legados precisarem dele;
o job não privatiza nem apaga vídeos legítimos da base.

O cliente pode criar a reserva e concluir o upload, mas não pode publicar resultados
derivados. O status `ready`, a transcrição, os frames e os tópicos são server-owned e
somente as funções de IA (ou um admin confiável) podem gravá-los.

`process-reference-video` exige ao menos três momentos visuais para marcar o item como
`ready` e, em vídeos com quatro segundos ou mais, ao menos dois momentos distintos em
`0–5 s`. O `assemble-script` também recusa o modo vídeo sem frames. Para o hook, o
montador usa exclusivamente a evidência `opening_hook` em até cinco segundos. **Toda
afirmação factual do hook**, e não apenas a primeira, precisa ser sustentada pelos
frames ou pela fala sobreposta dentro de `0–5 s`. Fatos posteriores, ainda que sejam
verdadeiros no restante do arquivo, não podem confirmar nem completar o hook. A
curiosidade nasce de esconder a consequência, nunca de resumi-la antecipadamente.

Nos demais blocos, a linha do tempo é particionada continuamente, sem lacunas nem
sobreposições. Quando há transcrição temporal confiável, os limites internos são
ajustados aos finais reais dos microeventos; sem fala suficiente, o sistema usa a
partição estrutural uniforme. Frames e segmentos pertencem a um único intervalo e o
mesmo contrato é recalculado pelo montador e pelo validador.

### Fonte do gancho: fala, nunca título

O título publicado no YouTube é metadado de identidade e engajamento. Ele **não é**
evidência do gancho, não entra em `video_blocks.texto` e não participa da extração
de palavras, frases ou assinaturas estratégicas.

Para cada vídeo da Base Viral, o contrato falha fechado a menos que:

1. cada segmento de `video_transcripts` seja atribuído exatamente uma vez ao bloco
   com maior sobreposição temporal;
2. o texto persistido de cada bloco seja a concatenação exata desses segmentos,
   preservando ordem e pontuação da transcrição;
3. o `hook` seja o primeiro bloco falado real e exista uma cadeia posterior com
   `desenvolvimento` e `payoff`;
4. cada palavra-chave e frase forte persistida apareça de fato no texto falado do
   próprio bloco;
5. alterações no título não mudem o DNA, enquanto alterações na fala mudem a
   assinatura estratégica correspondente.

Uma IA pode sugerir limites e tipos de bloco, mas qualquer paráfrase que ela escreva
é descartada antes da persistência. A auditoria nominal da base registra, vídeo por
vídeo, o gancho falado, os segmentos usados e a cobertura de palavras/frases. O
preset só pode ser publicado quando todo o inventário selecionado passa essa prova.

## 8. Gancho Apelão e desenvolvimento

Com **Gancho Apelão** ligado, o contrato acrescenta:

- narração completa do hook em **3–5 segundos**, limitada ao que o conteúdo realmente
  entrega;
- faixa efetiva calculada pelo `avg_words_per_second` do hook (`ceil(3 × WPS)` a
  `floor(5 × WPS)`); se uma faixa legada for incompatível, o contrato temporal
  explícito prevalece;
- primeira afirmação factual ancorada nos pixels de `0–5 s`;
- todas as demais afirmações factuais do hook também limitadas a `0–5 s`, sem usar o
  restante do vídeo como suporte;
- proibição de inventar fatos para aumentar a promessa;
- uma ação, consequência ou micro-revelação nova por frase;
- escalada causal até o payoff, sem repetir a frase anterior.

Essas regras complementam o perfil medido do preset; não substituem a faixa de
palavras, o tipo de abertura, o ritmo ou a progressão extraídos da base, exceto quando
a faixa histórica de palavras é matematicamente incompatível com o limite explícito
de cinco segundos.

### Analogia contextual do hook

O pacote pode persistir uma assinatura de estratégia falada por vídeo sem incluir o
texto-fonte ou o título. O Escritor escolhe primeiro um `matched_analog` apenas quando
há semelhança funcional de risco, ação, relação ou mecanismo de revelação. Ele transfere
a mecânica de abertura, ritmo e curiosidade, nunca uma frase nem uma troca mecânica de
substantivo. Se nenhum vídeo for realmente semelhante, usa `aggregate_fallback` e
sintetiza a partir dos padrões agregados, sempre com os fatos operacionais novos.

Geração inicial, revisão, validação e promoção recalculam a mesma faixa efetiva por
slot. A contagem total correta não compensa um hook fora de 3–5 segundos.

## 9. Guarda anti-cópia e validação fail-closed

Há quatro barreiras:

1. **Isolamento do prompt:** exemplos, frases de impacto e vocabulário literal da
   base não são renderizados para o modelo.
2. **Guarda lexical pós-geração:** cada bloco é comparado às referências protegidas
   do mesmo tipo. Uma sequência contígua compartilhada de quatro ou mais palavras
   reprova o bloco (`max_exact_ngram = 3`), assim como similaridade lexical acima de
   `max_content_similarity = 0.62`. A cobertura é validada por vídeo-fonte distinto:
   até 128 fontes por tipo de bloco, a ausência de qualquer referência esperada faz o
   pacote falhar fechado; para bases maiores, aplicam-se as 128 referências de maior
   engajamento.
3. **Guarda semântico multilíngue:** um juiz separado compara o conteúdo mesmo quando
   a base e a saída usam idiomas diferentes; `max_semantic_similarity = 0.78`.
   Ausência de referências ou falha do juiz reprova, em vez de aprovar por omissão.
4. **Conformidade estrutural:** o bloco recebe pontuação pelos critérios aplicáveis,
   incluindo faixa de palavras, faixa de frases, padrão de abertura, retenção do
   payoff no hook e progressão nos blocos intermediários.

O montador faz até **três tentativas totais** por bloco quando há cópia ou baixa
conformidade. Para ser aceito, o bloco precisa alcançar `min_strategy_score = 0.82` e
passar o guarda anti-cópia. Se ainda falhar, recebe `strategy_failed`; um slot
obrigatório nessa condição deixa a montagem incompleta.

`validate-script-against-dna` trata como críticas a ausência de estratégia, a baixa
conformidade, a falha do guarda e, no modo vídeo, a ausência de contexto visual. A
revisão v3 chama novamente o montador estrito, em vez de usar um prompt de revisão que
poderia reintroduzir frases literais.

Os limiares lexical e semântico são travas efetivas no `assemble-script`, não apenas
métricas informativas. As referências literais são usadas somente depois da geração,
no guarda, e nunca como material de continuação do prompt. O limite de 128 controla
somente a evidência persistida para comparação pós-geração; não reduz o número de
vídeos que contribuem para as métricas e estratégias abstratas do Preset DNA.

## 10. Upload de até 300 MB

A Biblioteca e o modo vídeo aceitam arquivos de até **300 MiB** (`300 * 1024 *
1024`) e usam TUS com blocos de 6 MiB, tentativas progressivas e retomada de upload.
Arquivos maiores são recusados antes do processamento.

Para análise multimodal, o backend usa `GEMINI_API_KEYS` e a Gemini Files API. O pool
rotativo também atende às funções narrativas e elimina a dependência do Lovable AI
Gateway. `GEMINI_API_KEY` é aceito somente como fallback legado. Sem nenhuma chave
Gemini, o processamento falha explicitamente com `VIDEO_AI_NOT_CONFIGURED`. Os detalhes
estão em `docs/INGESTION-DEPLOYMENT.md`.

O limite de 300 MiB não elimina limites de duração e CPU do plano Supabase. Processar
muitos vídeos longos pode exigir um worker persistente consumindo a mesma fila.

## 11. Ingestão por URL sem limite visível

Tanto a Biblioteca quanto o modo Vídeo da Geração aceitam uma lista sem limite
visível de URLs de vídeos individuais, com uma URL por linha. A interface valida,
normaliza e remove duplicatas antes de enviar; todos os itens válidos continuam na
fila, mas são processados em lotes internos de 25 para não sobrecarregar navegador,
banco e provedores. Falhas são isoladas por item e podem ser reenviadas sem repetir
os vídeos que já ficaram prontos.

"Sem limite visível" significa que o produto não impõe um teto arbitrário ao campo,
e não que recursos físicos sejam infinitos: tempo, armazenamento, cotas da IA,
limites do provedor e concorrência ainda se aplicam. Para lotes muito grandes, a fila
continua avançando em blocos até consumir a lista.

Há duas finalidades diferentes, que não devem ser misturadas:

| Entrada | Persistência | Uso |
|---|---|---|
| **Base Viral / Biblioteca** | `videos` + fila e análises da Biblioteca | Depois de concluída, pode ser selecionada para consolidar um Preset DNA |
| **Novo vídeo / Referência da Geração** | `reference_videos` | Fornece somente os fatos, imagens, ações e ordem do roteiro atual; não entra automaticamente na Base Viral |

Na Geração, cada link de referência é baixado e analisado separadamente. Quando o
item chega a **Análise pronta**, o usuário escolhe **Usar neste roteiro**; o DNA do
preset selecionado é então aplicado àquele conteúdo operacional. Assim, a base
transfere a estratégia e o vídeo novo fornece a verdade visual e factual.

Há chave de idempotência: reenviar a mesma origem não cria outra cópia; um item falho
volta para a fila e um item em andamento ou concluído é reutilizado.

Links de canal, perfil ou playlist são recusados de propósito, porque não identificam
um único vídeo. Para importar um canal, é necessário resolver primeiro os vídeos
individuais e enviar cada URL. O site atual não percorre automaticamente todos os
vídeos de um canal.

Edge Functions do Supabase não executam o binário `yt-dlp`. Em produção, o caminho
confiável é configurar:

```bash
supabase secrets set YTDLP_SERVICE_URL=https://seu-worker.example/v1/resolve
supabase secrets set YTDLP_SERVICE_TOKEN=...
```

O contrato desse worker e o formato da resposta estão em
`docs/INGESTION-DEPLOYMENT.md`. Sem ele, `download-video` tenta Cobalt e Invidious
como contingência; esses serviços públicos podem mudar, limitar acesso ou ficar
indisponíveis e não oferecem a mesma confiabilidade de um worker yt-dlp controlado.

Em desenvolvimento local, o Vite oferece `/api/local-ytdlp`: ele valida a sessão do
Supabase, aceita somente origens de vídeo permitidas, executa `yt-dlp` sem shell e
envia o arquivo diretamente ao Storage. Esse middleware é apenas local; ele não
substitui o worker HTTPS no deploy de produção.

## 12. Loop Escritor/Avaliador e gates pré-publicação

No modo Vídeo, depois da primeira montagem, o backend executa dois papéis separados:

1. `dna_writer` escreve ou revisa os blocos usando os fatos e frames do vídeo novo,
   o contrato abstrato do preset e o feedback anterior. Ele não pode aprovar a
   própria saída.
2. `viral_evaluator` somente avalia hook, desenvolvimento, payoff, fidelidade visual,
   aplicação do DNA, originalidade e ritmo. Ele produz problemas por bloco e mudanças
   obrigatórias, mas não reescreve o roteiro.

Em paralelo ao Avaliador, um auditor narrativo independente recebe todos os
`event_id` locais e o contexto visual de cada intervalo. Ele exige um veredito para
cada evento, detecta omissão parcial, distorção, alteração causal, fato inventado e
vazamento entre blocos. O Escritor precisa reconhecer exatamente os IDs do próprio
slot e apontar a cláusula do texto que cobre cada um; essa declaração ainda é
reavaliada semanticamente e não vale como autoaprovação. Numa revisão, eventos já
aprovados viram `MUST_PRESERVE` e os falhos viram `MUST_RESTORE_COMPLETELY`.

O ciclo **escrever → avaliar → revisar** é limitado a quatro avaliações. Entre uma
reprovação e a próxima avaliação, o Escritor revisa os blocos apontados. O valor
`passed` devolvido pelo modelo nunca é confiado: o software normaliza os números e
calcula os gates localmente. Cada ciclo grava fingerprint do rascunho, avaliação,
feedback, blocos alterados, modelo e latência em `writer_evaluator_loop.audit_trail`.

Para aprovação, todos estes gates precisam passar ao mesmo tempo:

- estimativa de **continuaram assistindo ≥ 86%**;
- estimativa de **pularam o vídeo < 10%**;
- as duas taxas acima precisam ser complementares, com tolerância máxima de 1 ponto;
- estimativa de **duração média assistida ≥ 90%** do vídeo;
- nota geral **≥ 9,0/10**;
- notas de hook, desenvolvimento, payoff e fidelidade visual **≥ 8,5/10** cada.
- auditoria factual de **todos os microeventos = aprovada**, sem lacuna narrativa,
  alteração causal, invenção ou vazamento temporal.

Se o Avaliador ou Escritor falhar, se os quatro ciclos terminarem sem aprovação ou se
qualquer gate ficar abaixo do mínimo, o fluxo falha fechado: validação, revisão e
promoção final não podem tratar o roteiro como aprovado.

Na interface, uma reprovação puramente qualitativa com
`termination_reason = "max_iterations_reached"` pode acionar até duas novas montagens
externas. Erros do Escritor/Avaliador, ausência de relatório, timeout ou falha de
provedor continuam interrompendo o fluxo. Nenhuma tentativa reprovada pode ser
promovida.

As saídas que carregam aprovação são server-owned: membros comuns podem ler suas
próprias linhas em `script_assemblies` e `promoted_scripts`, mas somente as Edge
Functions (ou uma ferramenta administrativa confiável) podem inseri-las ou alterá-las.
Assim, o navegador não pode fabricar um relatório aprovado.

Esses percentuais têm `metrics_kind = "pre_publication_ai_estimates"`: são estimativas
de qualidade antes da publicação, não dados reais do YouTube nem promessa de
resultado. Métricas reais só existem depois que o vídeo é publicado e assistido. O
relatório da interface deixa essa distinção explícita.

## 13. Fluxo do usuário

```text
BIBLIOTECA / BASE VIRAL (/library)
1. Enviar arquivos ou colar vários links, um por linha.
2. Aguardar status Concluído com transcrição, análise visual e blocos.
3. Clicar em Selecionar e marcar pelo menos três vídeos.
4. Nomear e criar o Preset DNA.

GERAÇÃO (/app ou /dashboard/script-engine)
1. Escolher vídeo, tema ou transformar.
2. Selecionar Base Global ou um preset salvo.
3. Manter ou desligar Gancho Apelão.
4. No modo vídeo, enviar um arquivo ou colar vários links, um por linha.
5. Aguardar **Análise pronta** e clicar **Usar neste roteiro** no item desejado.
6. Gerar: contexto visual → DNA v3 → montagem → anti-cópia → Escritor/Avaliador.
7. Conferir o relatório dos agentes; somente uma execução aprovada pode seguir para
   validação e promoção final.
```

## 14. Deploy obrigatório

Alterar os arquivos locais não atualiza sozinho o backend remoto. Antes de considerar
o v3 ativo em produção:

1. aplique as migrações de ingestão/idempotência com `supabase db push`;
2. configure `GEMINI_API_KEYS` e, para yt-dlp confiável,
   `YTDLP_SERVICE_URL`/`YTDLP_SERVICE_TOKEN`;
3. publique as funções de ingestão descritas em `docs/INGESTION-DEPLOYMENT.md`;
4. publique também as funções do contrato v3:

```bash
supabase functions deploy build-complete-generation-context
supabase functions deploy assemble-script
supabase functions deploy validate-script-against-dna
supabase functions deploy revise-script-assembly
supabase functions deploy promote-script-final
supabase functions deploy extract-block-semantics
```

5. publique o frontend que contém upload TUS, seleção de preset e tratamento dos
   estados de erro;
6. execute testes e uma prova autenticada ponta a ponta no ambiente implantado.

O deploy exige credenciais do projeto Supabase e segredos válidos. Sem eles, o código
local pode compilar e passar nos testes, mas a instância publicada continuará usando
a versão anterior das Edge Functions.

## 15. Critérios objetivos para considerar o fluxo saudável

Antes de criar um preset:

- `videos.status = completed`;
- existem segmentos em `video_transcripts`;
- `video_metadata.multimodal_visual_analysis` contém ao menos três momentos;
- existem blocos narrativos e evidência em `visual_block_analysis`;
- métricas de engajamento estão presentes quando se deseja ranking por performance.

Antes de montar um roteiro:

- `generation_contexts.status = ready`;
- `generation_rules.style_pack.version >= 3` e `status = ready`;
- o contrato e os perfis obrigatórios estão presentes;
- no modo vídeo, há `topic_analysis` e `visual_frames`;
- no modo vídeo com o loop habilitado, `writer_evaluator_loop.passed = true`, há uma
  `final_evaluation` e a trilha de auditoria corresponde ao rascunho aprovado;
- nenhum bloco obrigatório termina como `strategy_failed`, `generation_error`,
  `insufficient_data` ou `empty`;
- validação de estratégia, anti-cópia e contexto visual passam.

Esses critérios tornam falhas observáveis e impedem improvisação silenciosa. Eles não
transformam uma previsão de engajamento em certeza matemática; servem para garantir
que o roteiro aceito foi gerado com a estratégia extraída, com evidência suficiente e
sem cópia literal detectada pelo guarda implementado.
