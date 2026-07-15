# DNA Viral — estado de continuidade

> **Documento histórico.** As provas e contagens deste arquivo refletem o estado anterior à auditoria visual aprofundada de 15/07/2026. Para continuar o trabalho, use `STATUS-DNA-VIRAL-2026-07-15.md`; resultados antigos que depois falharam em gates mais fortes não devem ser tratados como aprovação atual.

**Última atualização verificada:** 15/07/2026, 00:46 (America/Sao_Paulo)

Este documento permite continuar o projeto sem depender do histórico da conversa. Ele registra somente fatos verificados no código, no Supabase e no teste ao vivo. Não contém credenciais, transcrições integrais, frames integrais nem roteiros-fonte da Base Viral.

## Resultado atual

O fluxo operacional está completo: recebe vídeos por arquivo ou por vários links individuais, analisa áudio e pixels, aplica a estratégia abstrata do preset compartilhado, gera um roteiro visual-first, executa os agentes Escritor DNA e Avaliador Viral, valida formalmente e só promove quando todos os contratos passam.

O teste final com o vídeo `1-4.mp4` foi **aprovado e promovido**. O hook ficou em `4,627 s` estimados, ancorado exclusivamente em frames dos primeiros `5 s`, e o roteiro passou `63/63` critérios formais.

## Links e servidor independente do Codex

- Aplicação: <http://localhost:8080/>
- Nova Geração: <http://localhost:8080/app>
- Biblioteca / Base Viral: <http://localhost:8080/library>
- Rede local: `http://SEU_IP_LOCAL:8080/`
- Biblioteca pela rede local: `http://SEU_IP_LOCAL:8080/library`

A tarefa agendada do Windows `DNAViralDevServer` está em estado `Running`. Ela mantém o Vite fora do processo do Codex; fechar a janela do Codex não deve derrubar o site enquanto o Windows permanecer ligado e o usuário estiver conectado.

```powershell
Get-ScheduledTask -TaskName DNAViralDevServer
Start-ScheduledTask -TaskName DNAViralDevServer
Invoke-WebRequest -UseBasicParsing http://localhost:8080/
```

Na última checagem, `/`, `/app`, `/library` e os endereços LAN responderam HTTP `200`. Computador desligado, suspensão do Windows, troca de IP local ou firewall de outro dispositivo continuam sendo condições externas ao app.

## Como usar na interface

1. Entre com qualquer conta autenticada.
2. Abra `/library` para alimentar a Base Viral ou criar presets próprios.
3. Para importar vários vídeos, cole **um link individual de vídeo por linha**. Não existe limite numérico artificial no campo; a fila deduplica, divide o trabalho em lotes e retoma itens persistidos. O limite prático é rede, armazenamento e quota do provedor. URLs de canal ou playlist são recusadas para impedir uma importação acidentalmente infinita.
4. Em `/app`, escolha **Gerar de Novo Vídeo**. É possível enviar arquivo ou adicionar vários links de vídeos operacionais.
5. Escolha `Base Global` ou um preset. A Base Global resolve automaticamente o preset compartilhado ativo de 50 Shorts.
6. Deixe `Gancho Apelão` ligado. O impacto pode ser forte, mas fatos, pessoas, objetos, intenção, frequência e desfecho precisam continuar comprovados pelo vídeo novo.
7. Gere. Cada vídeo pronto da fila recebe execução e resultado isolados; uma falha não apaga os outros itens.

## Base Viral compartilhada

| Campo | Valor verificado |
|---|---:|
| Nome | `Base Viral — 50 Shorts Fornecidos (Jul 2026)` |
| Preset ID | `ID-REMOVIDO-NA-COPIA-PUBLICA` |
| Compartilhado | sim (`created_by = null`) |
| Ativo | sim |
| Entradas fornecidas | 61 |
| Duplicatas removidas | 11 |
| Vídeos únicos concluídos | 50/50 |
| Falhas de processamento | 0 |
| Confiança persistida | 100 |
| Tipos de bloco consolidados | 8 |
| Exemplos protegidos contra cópia | 331 |
| Segmentos falados auditados | 1.592 |
| Blocos narrativos falados | 778 |
| Evidências visuais | 1.502 frames |

### Auditoria do DNA falado

- `50/50` vídeos têm estratégia falada individual registrada.
- Hooks e payoffs foram extraídos da **fala/transcrição**, não do título do YouTube.
- O título e o texto-fonte protegido não são enviados ao Escritor como modelo de frase.
- Cada um dos 50 vídeos tem analogia contextual de estratégia de hook, sequência, ritmo e evidência visual.
- A consolidação transfere padrão de abertura, lacuna de curiosidade, micro-revelações, escalada, tensão, payoff e ritmo; ela não autoriza tradução, paráfrase ou cópia da história-fonte.

### Auditoria visual

- 34 vídeos: análise multimodal Gemini, `1.006` frames.
- 16 vídeos: auditoria visual manual estruturada pelo Codex, `496` frames.
- Total: `1.502` frames em 50 vídeos.

Limite honesto da amostra: 16 dos 50 vídeos foram publicados no último mês na data da auditoria; 34 são mais antigos. A lista foi fornecida como viral, mas o sistema não comprovou por conta própria que todos eram os maiores do canal naquele mês. Também não houve análise causal do texto de comentários individuais. Isso não invalida o DNA extraído do conteúdo, mas não deve ser descrito como prova estatística completa de causalidade de views.

## Contrato novo do hook: 3–5 segundos

O hook agora é tratado como contrato técnico em toda a cadeia, não apenas como instrução de prompt.

1. A ingestão exige pelo menos dois momentos visuais com timestamps distintos dentro de `0–5 s` para vídeos com quatro segundos ou mais; timestamps duplicados são rejeitados.
2. A seleção `opening_hook` nunca usa frame posterior a `5 s`.
3. A primeira afirmação factual nasce da ação mais forte mostrada nessa abertura.
4. O restante do vídeo pode apenas esclarecer **identidade, risco ou finalidade da mesma ação inicial**, quando houver confirmação explícita em frames ou fala. Não pode substituir a abertura, inventar motivação ou antecipar o payoff.
5. A quantidade de palavras é calculada pelo ritmo medido do DNA. No preset atual, `3,89 palavras/s` gera faixa efetiva de `12–19 palavras` para o hook.
6. Geração inicial, revisão do Escritor, Avaliador, validador formal e promoção final recalculam a mesma faixa. Um hook fora dela é rejeitado mesmo que a contagem total do roteiro esteja correta.
7. Promessas vazias como “vai te chocar”, “você não vai acreditar”, “é inimaginável” ou “assista até o final” são bloqueadas quando o objeto/ação concreto pode ser nomeado.

### Adaptação contextual, sem troca mecânica de substantivo

O motor procura primeiro um hook falado da base com função semelhante: tipo de risco, ação, relação entre personagens e mecanismo de revelação. Se houver, transfere apenas a mecânica e a adapta aos fatos do vídeo novo. Exemplo conceitual: uma estratégia de perigo com uma barata no ouvido pode ser adaptada para uma formiga no ouvido se a nova evidência realmente mostrar a formiga.

Se nenhum dos 50 casos for funcionalmente semelhante, o sistema usa `aggregate_fallback`: sintetiza um hook com os padrões agregados observados, ainda ancorado nos fatos do vídeo novo. Não faz uma troca mecânica de palavras e não importa entidades ou cadeia causal do vídeo-fonte.

No teste final de `1-4.mp4`, nenhum caso da base foi suficientemente próximo; por isso o trace registrou `aggregate_fallback`, exatamente como a regra solicitada para situações sem analogia segura.

## Dois agentes e loop de revisão

- **Escritor DNA:** escreve ou revisa; nunca atribui nota nem se aprova.
- **Avaliador Viral:** avalia; nunca escreve o roteiro.
- Loop interno: até 3 avaliações e 2 revisões.
- Loop externo da interface: até 2 novas montagens quando o problema é somente `max_iterations_reached`.
- Erros de provedor, `writer_error`, `evaluator_error`, ausência de relatório ou tempo esgotado continuam parando o fluxo de forma segura.
- A página `/app` agora usa as tentativas externas de qualidade em vez de parar antes da validação. `/app` e `/dashboard/script-engine` seguem o mesmo princípio fail-closed.
- Promoção é impossível sem relatório aprovado, fingerprint do exato texto avaliado, contagem efetiva de cada bloco, cobertura visual e validação formal.

As metas configuradas são:

| Gate pré-publicação | Exigência |
|---|---:|
| Continuariam assistindo | `>= 86,0%` |
| Pulariam o vídeo | `< 10,0%` |
| Visualização média estimada | `>= 90,0%` |
| Nota geral | `>= 9,0/10` |
| Hook, desenvolvimento, payoff e fidelidade visual | `>= 8,5/10` |

Esses números são **estimativas de IA antes da publicação**, não analytics reais nem garantia de viralização. O software pode garantir que seus contratos foram executados; não pode garantir o comportamento futuro do público do YouTube.

## Prova ao vivo final com `1-4.mp4`

Fonte original:

```text
C:\caminho\video-exemplo.mp4
```

- Duração: `82,941995 s`.
- Resolução: `1080 × 1934`.
- Original: aproximadamente `89,7 MiB`.
- Cópia de teste com a mesma duração: `.runtime\target-preflight\1-4-under-50mb.mp4`, `8.343.118` bytes.
- Reference video ID: `ID-REMOVIDO-NA-COPIA-PUBLICA`.
- Transcrição: `23` segmentos.
- Análise visual: `28` frames.
- Tema: `Ganância e Vingança`.
- Generation context: `ID-REMOVIDO-NA-COPIA-PUBLICA`.
- Script assembly: `ID-REMOVIDO-NA-COPIA-PUBLICA`.
- Promoted script: `ID-REMOVIDO-NA-COPIA-PUBLICA`.

Hook aprovado:

> Este homem desce uma barata viva por um fio diretamente para dentro do ouvido de sua namorada adormecida.

| Prova do hook | Resultado |
|---|---:|
| Palavras | `18` |
| Faixa permitida | `12–19` |
| Ritmo medido | `3,89 palavras/s` |
| Duração falada estimada | `4,627 s` |
| Janela visual | `0–5 s` |
| Frames usados | `1,5 s` e `4,5 s` |
| Nota do hook | `9,5/10` |

Resultado do roteiro:

| Item | Resultado |
|---|---:|
| Blocos | `7/7` |
| Palavras totais | `199` |
| Critérios formais | `63/63` |
| Falhas críticas | `0` |
| Avaliações internas | `1` |
| Nota geral | `9,3/10` |
| Desenvolvimento | `9,2/10` |
| Payoff | `9,4/10` |
| Fidelidade visual | `9,8/10` |
| Aplicação do DNA | `9,5/10` |
| Originalidade | `9,0/10` |
| Ritmo | `9,3/10` |
| Continuariam (estimativa) | `90,5%` |
| Pulariam (estimativa) | `9,5%` |
| Visualização média (estimativa) | `91,5%` |
| Validação | `approved` |
| Promoção | `promoted` |

Relatórios seguros:

```text
.runtime\viral-preset-live\test-viral-preset-on-video-8e3242e1474bd6a9b4df3570.json
.runtime\viral-preset-live\test-viral-preset-on-video-8e3242e1474bd6a9b4df3570.md
```

O primeiro verificador local dessa execução recusou a promoção ao usar por engano o WPS de fallback no relatório. A fonte foi unificada com o WPS efetivo do slot; a montagem em si já tinha `18` palavras dentro de `12–19` e `4,627 s`. Depois da correção, a mesma montagem foi novamente validada e promovida. Nenhum resultado reprovado foi promovido.

## Upload de 300 MB

O front-end aceita até `300 MiB` e usa upload TUS retomável em chunks de `6 MiB`. Isso não remove o limite global do plano do Supabase. O projeto gratuito atual mantém teto operacional de aproximadamente `50 MB` por objeto; portanto o original de ~90 MiB precisou ser comprimido para o teste. Para armazenar diretamente arquivos de até 300 MiB, é necessário elevar o limite/plano do Storage. Essa alteração pode envolver cobrança e não foi feita automaticamente.

## Acesso de usuários

A migration `20260714123000_authenticated_viral_base_access.sql` está aplicada. Qualquer usuário autenticado pode ler e usar os presets compartilhados; cada pessoa continua com escrita isolada nos próprios dados. O teste `member-viral-base-access` cobre esse contrato.

## Funções publicadas em 15/07/2026

```text
assemble-script
validate-script-against-dna
promote-script-final
process-reference-video
transcribe-video
```

Elas incluem os contratos compartilhados de duração do hook, evidência visual inicial, revisão, validação por bloco e promoção fail-closed.

## Verificações finais

```text
npx vitest run                  # 62 arquivos / 523 testes passaram
npx tsc --noEmit               # passou
npm run build                  # passou
node scripts/sweep-routes.mjs  # 24 rotas, 0 erros/página/requisição
```

Também responderam HTTP `200`: localhost `/`, `/app`, `/library`, LAN `/` e LAN `/library`. O navegador embutido do Codex não estava disponível na última checagem visual, então a evidência de UI foi o sweep automatizado de navegador já existente, os testes React e as respostas HTTP. Os avisos de React Router, Browserslist e tamanho de chunk são não bloqueantes.

## Arquivos principais alterados nesta conclusão

```text
supabase/functions/_shared/viral-review-loop.ts
supabase/functions/_shared/dna-guards.ts
supabase/functions/_shared/visual-timeline-coverage.ts
supabase/functions/assemble-script/index.ts
supabase/functions/validate-script-against-dna/index.ts
supabase/functions/promote-script-final/index.ts
supabase/functions/process-reference-video/index.ts
supabase/functions/transcribe-video/index.ts
src/pages/app/UserGeneratePage.tsx
scripts/test-viral-preset-on-video-live.ts
src/test/regression/viral-review-loop.test.ts
src/test/regression/dna-v3-guards.test.ts
src/test/regression/contextual-hook-adaptation.test.ts
src/test/regression/generation-frontend-contracts.test.ts
src/test/unit/visual-timeline-coverage.test.ts
docs/DNA-VIRAL-STATUS-2026-07-14.md
```

## Como repetir a prova

O script abaixo obtém a credencial temporariamente pela sessão autenticada do Supabase CLI e não a grava no relatório:

```powershell
Set-Location C:\caminho\dna-viral
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-target-preset-live.ps1
```

Use `-NoReset` para retomar o checkpoint idempotente.

## Limites e segurança

- O runtime hospedado usa a rotação de modelos Gemini configurada no Supabase. O Codex fez a engenharia, auditoria manual de 16 vídeos, correções e prova ao vivo, mas esta conversa não permanece como um serviço de inferência dentro do app depois que a sessão termina.
- Para tornar um modelo OpenAI/Codex um segundo motor permanente seria necessária uma integração de API própria e credencial correspondente; isso não foi fingido neste estado.
- As chaves Gemini que foram coladas no histórico da conversa devem ser consideradas expostas e precisam ser revogadas/rotacionadas. Não registrar chaves em código, MD, logs ou screenshots.
- “100%” neste documento significa que os testes e gates de software listados passaram. Não significa garantia matemática de views, retenção ou viralização real.

## Atualização 2026-07-15 — prova com dois Shorts inéditos

Os Shorts `XdP0r2N6W8c` e `TjY5dX-ZSiY` foram baixados com `yt-dlp`, transcritos pelo áudio, analisados visualmente e processados de ponta a ponta usando o preset compartilhado **Base Viral — 50 Shorts Fornecidos (Jul 2026)**. Os dois roteiros foram formalmente aprovados e promovidos no Supabase.

O teste expôs e permitiu corrigir quatro classes de falha: possessivos confundidos com fala direta, perda do último frame no payoff, ausência de reparo de estratégia antes do Avaliador e contagem de palavras insuficiente para a duração real. As funções `assemble-script`, `validate-script-against-dna` e `promote-script-final` foram reimplantadas.

Verificação final desta atualização: **62 arquivos / 527 testes aprovados**, typecheck aprovado e build de produção aprovado.

O relatório completo, incluindo os ganchos realmente falados, IDs dos resultados promovidos, auditoria factual e os dois roteiros finais revisados pelo Codex, está em [TESTE-DOIS-SHORTS-2026-07-15.md](./TESTE-DOIS-SHORTS-2026-07-15.md).
