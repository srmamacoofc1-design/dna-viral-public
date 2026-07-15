# Status técnico final — DNA Viral

Data: 15/07/2026  
Projeto Supabase: `your-project-ref`

## Resumo executivo

O pipeline gera o roteiro a partir da fala e da sequência visual reais, aplica a estratégia do preset sem copiar títulos ou roteiros e bloqueia resultados que distorçam a premissa, pulem uma ação causal ou inventem uma acusação.

No nível de linguagem aceito pelo usuário em 15/07/2026, o fluxo está **operacional**: a prova live v17 concluiu upload, análise, aplicação do preset, Escritor, Avaliador, validação e promoção. A construção `até onde ficar deitado levaria ele?` foi explicitamente aceita pelo usuário como adequada ao registro do canal. As funções publicadas foram sincronizadas depois das falhas históricas v13–v16.

“Operacional” significa que o software executa os gates e entrega ou bloqueia o roteiro. Não significa garantia matemática de viralização nem que todo vídeo futuro será aprovado na primeira tentativa.

## Correções implementadas

### Gancho falado e premissa

- Foi criado um contrato determinístico de premissa falada entre fonte e roteiro.
- Um especialista reduzido extrai da fonte sujeito, relação, intenção, alvo, tempo e polaridade sem consultar título, DNA, frames posteriores ou desfecho.
- O gancho especialista precisa preservar a cláusula-alvo completa. Trocar a premissa por outra ação visual ou por um resumo abstrato falha fechado.
- A cláusula falada e uma ação visual comprovada de 0–5 s ficam congeladas. Um segundo juiz bilíngue compara sujeito, relação, alvo, tempo e polaridade antes de aceitar a tradução.
- O especialista final não pode mais reescrever o gancho inteiro: ele retorna somente a lacuna de curiosidade, e o código monta `premissa + ação visual + loop`.
- Há cobertura para o caso em que `queria passar o dia deitado` era indevidamente trocado por `prefere deslizar`.

### Cadeia visual, OCR e vídeos sem fala

- A cadência de três segundos passou a ser orientação, não permissão para apagar ações curtas.
- A análise deve preservar ação inicial → ponte/resultado imediato → reação → consequência.
- Regras materiais determinísticas agora reconhecem transições temporais em OCR, avanço/ataque dirigido, captura/consumo de objeto e consequência física visível.
- O auditor independente promove esses eventos a obrigatórios mesmo quando uma classificação probabilística os chama de redundantes.
- As regras também se aplicam aos eventos visuais principais, o que protege vídeos sem transcrição e somente com música.

### React e separação de planos

- O reagente e o vídeo incorporado são tratados como sujeitos e planos distintos.
- Reação facial ou gesto do reagente não pode virar ação, relação ou intenção de quem aparece no conteúdo reagido.
- A história precisa respeitar quem está visível em cada momento, sem antecipar personagem ausente do quadro.

### Português cotidiano e polêmica com prova

- O detector de registro formal foi ampliado para construções como `realizou um experimento`, `exibe`, `qual a consequência`, `recipiente de comida`, `uso contínuo`, `condição em que vive`, `relata` e outras frases robóticas.
- Substituições seguras convertem termos como `imediatamente`, `posteriormente`, `consequentemente`, `entretanto`, `exibe` e `recipiente de comida` para fala cotidiana.
- A preservação de maiúsculas/minúsculas foi corrigida para não produzir frases como `Na Mesma Hora`.
- Termos populares fortes continuam permitidos quando existe comportamento local compatível; acusações factuais graves continuam exigindo evidência explícita.

### Escritor, Avaliador e promoção

- O Escritor não aprova o próprio resultado.
- O Avaliador e as validações determinísticas podem pedir revisão ou bloquear a promoção.
- Cobertura visual aparente não é aceita quando um evento obrigatório foi omitido ou distorcido.
- O fluxo permanece fail-closed: saída parcial ou reprovada não deve virar script final.

## Validações já comprovadas

- Regressões finais focadas do gancho/auditor: **94/94 aprovadas**.
- TypeScript: **`npx tsc --noEmit` aprovado**.
- Build: **`npm run build` aprovado**.
- Edge Functions publicadas e sincronizadas no projeto: `process-reference-video`, `assemble-script`, `validate-script-against-dna`, `revise-script-assembly` e `promote-script-final`.

### Suíte completa

- Comando: `npx vitest run --reporter=dot --silent=passed-only`.
- Resultado final após o contrato de hook congelado e a documentação dos três formatos: **88 arquivos e 954/954 testes aprovados; 0 reprovados**.
- Duração da execução final: **19,03 s**, iniciada às **20:06:22** de 15/07/2026.

### Prova live v12 — bloqueio correto que originou o contrato final

- Formato: vídeo com fala/historinha (`4mzls0Mge1A`).
- Resultado: **bloqueado antes do Avaliador**, sem promoção e sem métricas estimadas.
- Tentativa 1: assembly `ID-REMOVIDO-NA-COPIA-PUBLICA`; erro `draft_contract_incomplete:1,7`.
- Tentativa 2: assembly `ID-REMOVIDO-NA-COPIA-PUBLICA`; erro `draft_contract_incomplete:1`.
- Motivo real: o hook trocou a premissa falada “queria passar o dia deitado” por “preferia deslizar” e não abriu uma lacuna concreta. O sistema recusou os dois resultados e não os promoveu.
- Relatório: `.runtime/viral-preset-live/generalization-4mzls-v12/test-viral-preset-on-video-1ee7d60f777c7b1b5d0921b7.md`.
- Correção posterior: premissa falada e ação visual passaram a ser validadas/congeladas; um juiz bilíngue independente compara os papéis semânticos; a IA só gera a `loop_clause`.

### Prova live v13 — aprovação automática invalidada pela auditoria humana

- Formato: vídeo com fala/historinha (`4mzls0Mge1A`), 42,301 s, com 9 segmentos falados e 29 momentos visuais.
- Run key: `0b61ea5097af94e917d419ba`.
- Preset: `ID-REMOVIDO-NA-COPIA-PUBLICA` (`Base Viral — 50 Shorts Fornecidos (Jul 2026)`).
- Reference video: `ID-REMOVIDO-NA-COPIA-PUBLICA`.
- Generation context: `ID-REMOVIDO-NA-COPIA-PUBLICA`.
- Script assembly: `ID-REMOVIDO-NA-COPIA-PUBLICA`.
- Promoted script: **nenhum**; o assembly permaneceu `draft`.
- Relatório: `.runtime/viral-preset-live/generalization-4mzls-v13/test-viral-preset-on-video-0b61ea5097af94e917d419ba.md`.

O Escritor e o Avaliador rodaram duas iterações e encerraram com `quality_gate_passed`. A validação formal marcou `approved`, nota geral estimada de **9,1/10** e nenhum gate automático reprovado:

- hook `9,2`; desenvolvimento `9,0`; payoff `9,1`; fidelidade visual `9,5`; aplicação do DNA `9,3`; originalidade `8,8`; ritmo `9,2`;
- 7/7 slots preenchidos, 100/100 critérios verdadeiros, zero falha crítica, contrato global de palavras aprovado e linha do tempo visual aprovada;
- gancho com 18 palavras, 3,89 palavras/s e 4,627 s estimados dentro da janela de 0–5 s;
- grounding visual e semântico do gancho, estratégia DNA, idioma, copy guard, fingerprint corrente e resolução hook→payoff marcados como aprovados;
- auditoria narrativa automática: 19/19 microeventos, 28 candidatos visuais, 10 eventos visuais obrigatórios, zero lacuna completa e zero erro causal.

| Métrica estimada antes da publicação | v13 |
|---|---:|
| Continuaram assistindo | 90,2% |
| Pularam o vídeo | 9,6% |
| Duração média assistida | 91,8% |

Esses números são estimativas do Avaliador de IA, não métricas reais nem garantia de desempenho.

Gancho produzido:

> ele queria ficar deitado o dia todo e homem desliza pela escada; por que ficar deitado atrai tanto?

A conferência humana contra a transcrição e os frames **reprovou** esse resultado por dois defeitos no gancho:

1. `e homem desliza` perdeu o artigo e produziu uma frase gramaticalmente quebrada, com pontuação pouco natural para narração falada.
2. `por que ficar deitado atrai tanto?` é uma lacuna abstrata e já antecipa a atração que pertence ao payoff, enfraquecendo a curiosidade em vez de esconder a consequência.

A premissa falada `queria passar o dia deitado` foi preservada e `desliza pela escada` corresponde à ação real dos primeiros segundos. A ordem dos acontecimentos também ficou fiel, sem alucinação material identificada. Mesmo assim, o corpo ainda soou artificial em construções como `mantendo seu estilo único de se mover sempre` e, no payoff, `seu jeito peculiar tinha um charme inesperado`. Isso não atende ao português popular pedido pelo usuário.

Como referência de correção humana — e **não** como resultado aprovado da v13 —, uma abertura compatível com a fala, os frames e a janela seria: `Esse homem queria passar o dia deitado e descia escadas, mas ninguém imaginava onde essa vagabundagem ia levar ele.`

#### Promoção bloqueada e diagnóstico exato

Depois da validação `approved`, `promote-script-final` respondeu `status=blocked` e não retornou ID. A investigação foi somente leitura, sem repetir a promoção:

- `assemble-script` estava publicado na versão 159 e `validate-script-against-dna` na versão 81, ambas com o contrato novo;
- `promote-script-final` ainda estava na versão 40, com helpers anteriores ao campo assinado `visual_candidate_audit`;
- o helper efetivamente publicado na v40, executado contra o assembly persistido, devolveu exatamente: `writer_evaluator_loop evaluator evidence fingerprint is inconsistent with the persisted evaluation`;
- o helper local atual, executado contra o mesmo payload, devolveu `passed=true` e `reason=null`.

Portanto, o bloqueio de promoção desta execução veio de **skew de deploy** entre o fingerprint produzido/validado e o fingerprint recalculado pela função de promoção antiga. A função de promoção precisa ser republicada junto dos helpers atuais. Ainda assim, apenas republicá-la não tornaria a v13 aceitável: o texto continua reprovado pela auditoria humana e deve ser regenerado após a correção do gancho e do registro coloquial.

**Veredicto v13: reprovada; não usar como prova de prontidão.**

### Prova live v17 — resultado aceito e promovido

- Formato: vídeo com fala/historinha (`4mzls0Mge1A`), 42,301 s.
- Evidência operacional: 9 segmentos falados e 29 momentos visuais.
- Preset: `ID-REMOVIDO-NA-COPIA-PUBLICA` (`Base Viral — 50 Shorts Fornecidos (Jul 2026)`).
- Reference video: `ID-REMOVIDO-NA-COPIA-PUBLICA`.
- Generation context: `ID-REMOVIDO-NA-COPIA-PUBLICA`.
- Assembly aprovada: `ID-REMOVIDO-NA-COPIA-PUBLICA`.
- Promoção final atual: `ID-REMOVIDO-NA-COPIA-PUBLICA`.
- Relatório: `.runtime/viral-preset-live/generalization-4mzls-v17/test-viral-preset-on-video-0b61ea5097af94e917d419ba.md`.

O ciclo Escritor ↔ Avaliador fez duas iterações e encerrou em `quality_gate_passed`. A validação formal aprovou 100/100 critérios, 7/7 slots, linha do tempo visual, faixa global de palavras, fingerprint corrente e resolução hook→payoff. A promoção foi refeita após a escolha final do usuário e retornou `status=promoted`.

Gancho final aceito:

> Ele queria ficar deitado o dia todo. O homem desliza pela escada; até onde ficar deitado levaria ele?

O gancho preserva a premissa falada e a ação realmente mostrada nos primeiros segundos, sem entregar sucesso profissional, festa ou interesse das mulheres. O restante do roteiro acompanha cama, higiene, roupa, escadas, trem, escritório, festa e payoff na ordem analisada.

| Métrica estimada antes da publicação | v17 |
|---|---:|
| Continuaram assistindo | 91,2% |
| Pularam o vídeo | 8,8% |
| Duração média assistida | 93,5% |
| Nota geral | 9,2/10 |

Essas porcentagens são estimativas pré-publicação do Avaliador, não métricas reais do YouTube.

Uma tentativa posterior (v18) usou a alternativa mais gramatical `até onde iria para ficar deitado?`, mas o validador de payoff a considerou ampla demais e bloqueou a promoção. Como o usuário preferiu e aceitou explicitamente a construção da v17, a v18 permanece apenas como regressão bloqueada e não como saída final.

### Cobertura dos três formatos

- **Fala/historinha:** prova live v17 aprovada e promovida.
- **Só música/história visual:** o perfil `construct_visual_story`, os eventos materiais, OCR temporal e os testes de cadeia causal estão ativos; música/letra não vira fato.
- **React:** o perfil `reaction_reframe`, a separação reagente ↔ vídeo incorporado e o auditor independente estão ativos.

Os dois últimos formatos estão cobertos pelo código e pelas regressões, mas os resultados live antigos de gato/cachorro e react continuam corretamente invalidados na seção seguinte. Eles não foram rebatizados como “aprovados” neste fechamento.

## Resultados anteriores que não contam como prova final

- O teste do gato/cachorro foi aprovado automaticamente, mas a auditoria manual encontrou uma cadeia visual causal omitida: captura/consumo do rato → esqueleto visto pelo cachorro → ataque. Esse resultado foi invalidado como prova final e motivou os novos eventos materiais obrigatórios.
- O teste de react foi aprovado automaticamente, mas a auditoria manual encontrou gesto atribuído incorretamente, choro não comprovado, personagem antecipada, OCR temporal omitido, repetição e linguagem formal. Esse resultado também foi invalidado como prova final.
- O teste anterior do homem falhou fechado porque o gancho trocava a premissa falada por outra ação. O novo contrato de premissa foi criado para impedir exatamente essa troca; a prova live v12 acima precisa confirmar o comportamento no backend publicado.

Essas invalidações são regressões conhecidas convertidas em guardas e testes. Elas não devem ser apresentadas como exemplos aprovados.

## Limitações honestas

- Nenhum modelo garante viralização, `+86%` de continuação, menos de `10%` de skip ou `+90%` de duração média. Antes da publicação, esses números são estimativas de IA.
- Análise visual, OCR e transcrição ainda são modelos probabilísticos. As regras determinísticas reduzem erros conhecidos, mas não tornam interpretação de vídeo infalível.
- A qualidade depende de o preset conter exemplos coerentes com idioma, formato e público do vídeo novo.
- Links podem falhar por remoção, login, região, idade, mudança da plataforma ou indisponibilidade do `yt-dlp`.
- Tempo de execução depende de tamanho, duração, rede, normalização, filas e cotas do provedor; não há SLA fixo.
- Um bloqueio do Escritor, Avaliador ou auditor é comportamento esperado quando a fonte não sustenta o texto. Não deve ser contornado com promoção manual.
- Para publicação importante, ainda é recomendada uma conferência humana do roteiro contra a sequência do vídeo.

## Operação

- Aplicativo: [http://localhost:8080](http://localhost:8080)
- Geração: [http://localhost:8080/app](http://localhost:8080/app)
- Base Viral: [http://localhost:8080/old-home](http://localhost:8080/old-home)
- Biblioteca/presets: [http://localhost:8080/library](http://localhost:8080/library)
- Guia completo: [GUIA-AUTOMACAO-DNA-VIRAL-2026-07-15.md](./GUIA-AUTOMACAO-DNA-VIRAL-2026-07-15.md)

## Segurança

Nenhuma chave está registrada neste documento. Chaves que já tenham sido expostas em conversa devem ser revogadas e recriadas. `service_role` e secrets de IA pertencem somente ao backend e nunca ao navegador ou a um relatório.
