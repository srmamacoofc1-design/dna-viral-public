# Ingestão multimodal — requisitos de deploy

O fluxo de Biblioteca e o modo Vídeo aceitam uploads retomáveis de até 300 MB e listas
de links sem limite visível. As URLs são normalizadas, deduplicadas e processadas em
lotes internos de 25; cada item tem estado e erro próprios. Um vídeo só é marcado
como concluído depois de obter transcrição real **e** observações visuais reais.

As duas entradas possuem destinos diferentes:

- **Base Viral / Biblioteca:** cria registros em `videos`; depois do processamento,
  eles podem compor um Preset DNA.
- **Referência da Geração:** cria registros em `reference_videos`; o item selecionado
  fornece o conteúdo visual/factual do roteiro atual e nunca entra automaticamente
  na Base Viral.

## Segredos obrigatórios

Configure no projeto Supabase:

```bash
# Valor recomendado: array JSON de chaves, salvo somente no cofre do Supabase.
supabase secrets set 'GEMINI_API_KEYS=["chave-1","chave-2"]'
supabase secrets set GEMINI_TEXT_MODEL=gemini-3.1-flash-lite
supabase secrets set GEMINI_VIDEO_MODEL=gemini-3.5-flash
supabase secrets set GEMINI_VIDEO_THINKING_LEVEL=minimal
```

`GEMINI_API_KEYS` habilita tanto as funções narrativas quanto a Gemini Files API.
O backend escolhe a próxima chave a cada requisição e muda automaticamente para a
seguinte em falhas de credencial, rede, limite ou indisponibilidade. O segredo legado
`GEMINI_API_KEY` ainda é aceito como fallback, mas não é necessário quando o pool está
configurado. Nenhuma função depende do Lovable AI Gateway.

Os modelos ficam configuráveis por segredo. Nesta implantação, Escritor,
Avaliador e juiz semântico usam `gemini-3.1-flash-lite`, escolhido depois de uma
prova de saída estruturada e contagem exata com o pool atual. A leitura forense de
vídeo continua separada em `gemini-3.5-flash`; nela,
`GEMINI_VIDEO_THINKING_LEVEL=minimal` reduz latência sem alterar as regras rígidas
do schema de saída. Trocar um desses valores exige repetir o teste ao vivo, pois
modelos diferentes podem obedecer de forma diferente aos contratos exatos.

Na análise visual, o arquivo é transmitido do Storage para a Gemini sem ser convertido
inteiro para base64, aguardado até ficar `ACTIVE`, usado na transcrição/análise visual e
removido ao final. Isso permite analisar os uploads de até 300 MiB aceitos pelo app sem
carregá-los inteiros na memória da Edge Function.

Observação: os limites da Gemini são contabilizados por projeto Google Cloud. Várias
chaves do mesmo projeto dão redundância de credencial, mas não multiplicam a cota desse
projeto.

`SUPABASE_ACCESS_TOKEN` é exigido somente pela CLI para publicar e consultar o
projeto; não deve ser cadastrado como segredo das Edge Functions. Autentique com
`supabase login` ou injete o token no ambiente seguro da automação, e vincule a CLI
ao `project-ref` correto antes dos comandos de banco e funções.

## Links do YouTube com yt-dlp

Uma Edge Function não executa binários nativos. Para usar o yt-dlp real em produção, configure um serviço privado que o execute:

```bash
supabase secrets set YTDLP_SERVICE_URL=https://seu-worker.example/v1/resolve
supabase secrets set YTDLP_SERVICE_TOKEN=...
```

Contrato do endpoint:

- `POST` JSON: `{ "url": "...", "format": "best[height<=720][ext=mp4]/best[height<=720]/best" }`
- endpoint obrigatoriamente HTTPS;
- autenticação recomendada: `Authorization: Bearer <YTDLP_SERVICE_TOKEN>`;
- resposta JSON: `{ "download_url": "https://url-temporaria-do-video" }`.

Para YouTube, `download_url` deve apontar para um proxy/arquivo servido pelo próprio
worker, ou para um objeto temporário em Storage. Não devolva simplesmente a URL
`googlevideo.com` impressa por `yt-dlp -g`: ela pode estar vinculada ao IP/cabeçalhos
do worker e falhar quando a Edge Function tentar baixá-la de outro endereço.

Sem esse serviço, `download-video` ainda tenta Cobalt e Invidious como contingência, mas eles não têm a confiabilidade de um worker yt-dlp controlado. Links de canal e playlist são recusados como `YOUTUBE_COLLECTION_NOT_A_VIDEO`; é necessário informar um vídeo ou Short específico.

Uma implementação pronta para container, com autenticação Bearer, proxy de bytes,
URLs HMAC temporárias, limite rígido de 300 MiB, timeout e testes está em
`services/ytdlp-worker/README.md`. O deployment deve usar uma origem HTTPS pública e
uma única réplica enquanto os arquivos temporários estiverem no disco local.

No servidor de desenvolvimento, `/api/local-ytdlp` é um middleware do Vite. Ele exige
uma sessão Supabase válida, limita origens, rejeita canal/playlist, executa o binário
sem `shell` e envia o arquivo diretamente ao Storage. Esse caminho existe somente em
desenvolvimento; o build publicado precisa do worker HTTPS acima.

## Banco e funções

Aplique primeiro as migrações (a migração de idempotência cria uma fila única por vídeo e uma chave única por metadado):

```bash
supabase db push
```

Depois publique as funções alteradas/novas:

```bash
supabase functions deploy download-video
supabase functions deploy transcribe-video
supabase functions deploy process-reference-video
supabase functions deploy import-reference-video
supabase functions deploy analyze-reference-topics
supabase functions deploy migrate-legacy-reference-videos
supabase functions deploy build-complete-generation-context
supabase functions deploy extract-visual-blocks
supabase functions deploy analyze-narrative
supabase functions deploy process-video-pipeline
supabase functions deploy assemble-script
supabase functions deploy validate-script-against-dna
supabase functions deploy revise-script-assembly
supabase functions deploy promote-script-final
```

Depois do deploy, use comandos somente leitura para confirmar o ambiente remoto:

```bash
supabase functions list --project-ref SEU_PROJECT_REF
supabase secrets list --project-ref SEU_PROJECT_REF
```

A listagem confirma nomes e versões publicadas sem revelar o valor dos segredos. Um
build local aprovado, por si só, não prova que essas versões chegaram ao Supabase.

`process-video-pipeline` usa `EdgeRuntime.waitUntil` quando disponível para que a orquestração continue no servidor após a resposta `202`. Ainda se aplicam os limites de duração/CPU do plano Supabase; para vídeos longos em volume, o caminho recomendado é acionar a mesma fila por um worker persistente.

O limite de 300 MB é um limite de aceitação e armazenamento. Uploads do navegador
usam TUS e são retomáveis; transferências por link e Storage → Gemini ainda precisam
terminar dentro do limite de execução do plano Supabase. Portanto, não trate 300 MB
como garantia de tempo de processamento em qualquer conexão/plano.

## Loop de qualidade no backend

`assemble-script` executa os papéis independentes `dna_writer` e `viral_evaluator`
por no máximo três avaliações. Uma reprovação gera feedback por bloco para a revisão
seguinte. O backend recalcula os gates sem confiar no `passed` emitido pelo modelo:

- continuaram assistindo ≥ 86%;
- pularam < 10% e as duas taxas são complementares com tolerância de 1 ponto;
- duração média assistida ≥ 90%;
- nota geral ≥ 9,0/10;
- hook, desenvolvimento, payoff e fidelidade visual ≥ 8,5/10.

Esses valores são identificados como estimativas de IA pré-publicação. Não são
métricas reais nem garantia de viralização. Se o loop não aprovar, as funções de
validação, revisão e promoção final bloqueiam a saída. Por isso, não basta publicar o
frontend: as quatro Edge Functions narrativas listadas acima precisam estar na mesma
versão do código.

A migração `20260713210000_server_owned_generation_outputs.sql` torna
`script_assemblies` e `promoted_scripts` somente leitura para membros comuns. Apenas
as Edge Functions com service role (ou uma ferramenta administrativa explicitamente
confiável) podem gravar aprovação, validação e promoção; o navegador não consegue
forjar `writer_evaluator_loop.passed`.

A migração `20260713213000_server_owned_reference_analysis.sql` aplica a mesma regra
às evidências multimodais. O navegador pode reservar/enviar uma referência privada em
estado bruto, mas não pode fabricar `ready`, transcrição, frames nem tópicos; esses
campos e tabelas filhas são gravados pelas funções de análise com service role.

## Remediação das referências antigas no bucket público

A migração `20260713211500_legacy_reference_storage_migration.sql` cria um ledger
durável para toda linha de `reference_videos` que ainda aponta para o bucket público
`videos`. Ela não altera o caráter público da Biblioteca Viral. A Edge Function
administrativa `migrate-legacy-reference-videos` faz, nesta ordem:

1. reserva jobs com lease atômico (`FOR UPDATE SKIP LOCKED`);
2. copia o objeto server-side para `reference-videos`, sem carregar até 300 MB na
   memória da função;
3. consulta os metadados do destino e exige tamanho não-zero exatamente igual;
4. troca `storage_bucket/storage_path` da linha somente após a verificação;
5. remove a origem apenas quando nenhuma outra referência nem registro da Biblioteca
   a utiliza, e confirma que o objeto público deixou de existir.

O namespace legado `reference/<user-id>/...` é limpo automaticamente. Uma origem
fora desse namespace fica em `source_retained` até revisão explícita; isso protege
vídeos públicos legítimos. Linhas antigas sem `user_id` são copiadas para
`reference/unowned/legacy/...`, inacessíveis a membros, para atribuição posterior por
um administrador.

Depois de `supabase db push` e do deploy da função, faça primeiro uma simulação com
um JWT de administrador (não use o token em histórico compartilhado):

```bash
curl -X POST "$SUPABASE_URL/functions/v1/migrate-legacy-reference-videos" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  --data '{"dry_run":true,"limit":50}'
```

Processe lotes idempotentes até `summary.claimed` retornar `0`:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/migrate-legacy-reference-videos" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  --data '{"limit":10}'
```

Revise no ledger os estados `failed` e `source_retained`. Para uma origem não
padronizada já confirmada como exclusiva, repita com
`{"include_source_retained":true,"force_unscoped_delete":true}`. Mesmo nesse modo,
o worker recusa a remoção se encontrar outra linha de referência, `videos`,
`video_metadata` ou `video_frames` usando o objeto.

## Critérios de saúde

Um item só deve aparecer como `completed` quando:

1. `video_transcripts` contém segmentos reais;
2. `video_metadata.multimodal_visual_analysis` contém pelo menos três momentos;
3. `visual_block_analysis` possui blocos com `data_source_type = gemini_video_understanding`;
4. `processing_queue.status = completed` e `error_message` está vazio.

Para uma geração por vídeo ser promovida, confirme também:

1. o item de `reference_videos` selecionado está `ready` e tem ao menos três momentos
   visuais reais;
2. `assembly_rules.writer_evaluator_loop.passed = true`;
3. `final_evaluation.metrics_kind = pre_publication_ai_estimates`;
4. a trilha `audit_trail` está presente e nenhuma revisão deixou slot obrigatório
   rejeitado.

Erros críticos mantêm `videos.status` e `processing_queue.status` em `failed`, com código/mensagem explícitos nos logs. Etapas derivadas (léxico, normalização e compatibilidade) são registradas como avisos e não apagam as evidências multimodais já extraídas.
