# Guia prático — usar e automatizar o DNA Viral

Atualizado em 15/07/2026 para o projeto Supabase `your-project-ref`.

Este guia separa duas coisas diferentes:

- **Base DNA:** vídeos virais usados somente como modelos de estratégia.
- **Vídeo novo:** conteúdo que será entendido visualmente e receberá um roteiro novo usando a estratégia do preset selecionado. Ele não entra na Base DNA por esse fluxo.

## Links do aplicativo

- Início: [http://localhost:8080](http://localhost:8080)
- Gerar roteiro de um vídeo novo: [http://localhost:8080/app](http://localhost:8080/app)
- Adicionar vídeos à Base Viral: [http://localhost:8080/old-home](http://localhost:8080/old-home)
- Acompanhar a fila da Base Viral: [http://localhost:8080/queue](http://localhost:8080/queue)
- Conferir vídeos e criar presets: [http://localhost:8080/library](http://localhost:8080/library)

Usuários autenticados podem adicionar e processar os próprios vídeos, criar presets pessoais e gerar roteiros. A tela [DNA Viral Global](http://localhost:8080/dna-viral) consolida o corpus compartilhado e, por segurança, é exclusiva de administrador; ela não é necessária para criar um preset pessoal.

Faça login antes de usar essas páginas. O servidor local roda pela tarefa agendada `DNAViralDevServer`, separada do Codex. Portanto, abrir o site no navegador ou fechar o Codex não deveria desligar o servidor.

Para conferir e iniciar o servidor no PowerShell:

```powershell
Get-ScheduledTask -TaskName "DNAViralDevServer"
Get-ScheduledTaskInfo -TaskName "DNAViralDevServer"
Start-ScheduledTask -TaskName "DNAViralDevServer"
```

Teste rápido depois de iniciar:

```powershell
(Invoke-WebRequest "http://localhost:8080/app" -UseBasicParsing).StatusCode
```

O resultado esperado é `200`.

## 1. Montar uma Base DNA com vários links ou arquivos

Use este fluxo para os vídeos virais que devem ensinar **estratégia**, não para o vídeo novo que receberá o roteiro.

1. Abra [Adicionar vídeos](http://localhost:8080/old-home).
2. Escolha arquivo ou entrada por link.
3. Para links, cole um endereço por linha e envie a lista à fila. Links repetidos do mesmo vídeo são deduplicados.
4. Acompanhe download, transcrição, análise visual, semântica e DNA verbal em [Fila](http://localhost:8080/queue). Nos vídeos pessoais, essas etapas são automáticas; espere o status **Concluído**.
5. Abra a [Biblioteca](http://localhost:8080/library), clique em **Selecionar** e marque somente os vídeos que realmente pertencem ao estilo desejado.
6. Clique em **Criar Preset DNA** e dê um nome claro, por exemplo `Historinhas PT-BR — julho 2026`.

Um preset exige pelo menos 3 vídeos distintos, concluídos, com visualizações e evidência suficiente de gancho, desenvolvimento, payoff e sequência visual. O botão fica bloqueado enquanto menos de 3 vídeos estiverem selecionados. Se um vídeo ainda não estiver pronto, volte à fila em vez de forçar a consolidação.

O campo aceita listas grandes, mas “ilimitado” não é uma garantia matemática: espaço, cota do provedor, disponibilidade do link e tempo de processamento continuam sendo limites reais. A fila existe para processar muitos itens sem precisar colá-los um por um.

O preset consolida padrões de gancho **falado**, progressão, ritmo, micro-revelações, tensão, linguagem e payoff. Título e descrição da plataforma não são tratados como o gancho narrado. O objetivo é adaptar estratégias; não copiar literalmente roteiros-fonte.

O registro coloquial aceito para este projeto inclui construções faladas como `até onde ficar deitado levaria ele?`. O objetivo do gate não é transformar a narração em português acadêmico: é manter sujeito, ação, contexto, curiosidade e desfecho corretos para o público do canal.

Somente um administrador pode aprovar vídeos para a Base Global ou executar a consolidação global em `/dna-viral`. Isso não reduz o preset pessoal: ele usa exatamente os vídeos que o usuário autenticado selecionou na própria biblioteca.

## 2. Gerar roteiro para um arquivo de até 300 MB

1. Abra [Geração](http://localhost:8080/app) e selecione **Gerar de Novo Vídeo**.
2. Em **Vídeo de Referência**, escolha **Enviar arquivo**.
3. Envie MP4, MOV, WebM ou AVI de até 300 MB.
4. Aguarde **Vídeo processado**, junto das quantidades de segmentos falados e momentos visuais.
5. Em **Base DNA (Preset)**, selecione o preset que deve fornecer a estratégia.
6. Mantenha **Gancho Apelão** ligado e use `pt-BR` como idioma.
7. Clique em **Gerar Roteiro Automaticamente**.
8. Só trate o texto como final quando ele aparecer aprovado em **Histórico** ou **Scripts Finais**.

Até 45 MB, o app faz upload retomável diretamente. De 45 a 300 MB, ele precisa estar aberto pelo endereço `localhost`, pois o helper local prepara uma versão segura antes do envio. O limite de 300 MB é rígido; arquivos maiores precisam ser convertidos ou reduzidos antes.

## 3. Gerar para vários vídeos novos por links

Este é o fluxo para aplicar um preset pronto em muitos vídeos novos. Esses vídeos operacionais não devem ser misturados automaticamente com os exemplos da Base DNA.

1. Abra [Geração](http://localhost:8080/app) e selecione **Gerar de Novo Vídeo**.
2. Escolha **Colar vários links**.
3. Cole um link por linha e clique em **Adicionar vídeos à fila**.
4. Espere cada item mostrar **Análise pronta**.
5. Para testar apenas um, clique em **Usar neste roteiro**.
6. Para continuar com todos os que já estão prontos, clique em **Gerar para todos os vídeos prontos**.
7. A geração ocorre em sequência para reduzir conflitos de cota. Uma falha fica isolada no item correspondente e os demais podem continuar.
8. Confira cada resultado em **Histórico** e **Scripts Finais**.

A fila de links fica salva no navegador e oferece retomada, mas não substitui um backup de produção. Não limpe os dados do navegador durante um lote importante.

## Como o sistema trata os três formatos

Não é necessário escolher manualmente um “tipo”. O analisador usa fala, pixels, OCR e ordem temporal disponíveis para decidir qual evidência deve mandar.

### Formato 1 — vídeo com fala ou historinha narrada

- A transcrição fornece a premissa falada: desejo, decisão, recusa, causa, estado e relações.
- A análise visual confirma quem executa cada ação e corrige contradições da fala.
- O gancho novo precisa preservar o fato central da abertura sem resumir o desfecho.
- O DNA altera a forma de prender atenção e desenvolver a história, não os fatos vistos ou ditos.

### Formato 2 — sem fala, só música ou react

- Música e letra não são prova de ação, parentesco, intenção ou desfecho.
- A narração nasce da sequência visual, incluindo ações curtas, objetos, consequências e textos relevantes na tela, como mudanças de tempo.
- Em react, o reagente e o vídeo incorporado ficam em planos separados. Uma expressão do reagente não pode virar ação do personagem do vídeo reagido.
- Quando não há transcrição útil, os pixels são a fonte principal do roteiro.

### Formato 3 — história existente, mas fraca ou mal narrada

- O sistema preserva a cadeia factual que realmente aparece: causa → ação → reação → consequência.
- Abertura, ordem das micro-revelações e payoff podem ser reconstruídos com a estratégia do preset.
- Palavras difíceis ou formais são trocadas por fala cotidiana em PT-BR.
- Um termo polêmico só pode ser usado quando a cena ou a fala local dão suporte. O sistema não deve inventar crime, traição, paternidade, casamento ou intenção escondida para deixar a história “mais forte”.

## O que o Escritor e o Avaliador verificam

- O gancho usa evidência da abertura e deve caber aproximadamente nos primeiros 3–5 segundos falados.
- A premissa falada importante não pode ser trocada por um rótulo abstrato ou por uma ação visual diferente.
- A sequência precisa manter sujeito, objeto, causa e ordem temporal.
- Ações curtas que conectam causa e consequência, além de OCR material como `um ano depois`, não podem desaparecer só porque parecem redundantes.
- Cada frase deve avançar a história com uma nova informação local; repetição visual não conta como nova revelação.
- Termos populares como `preguiçoso`, `vagabundagem` ou `cara de pau` exigem comportamento compatível na fonte.
- Acusações como `traição`, `ela era do job`, crime, paternidade ou relação escondida exigem prova explícita. Aparência, roupa, música ou reação isolada não bastam.
- Expressões formais devem virar linguagem falada: `imediatamente` → `na mesma hora`, `posteriormente` → `depois`, `entretanto` → `mas`.
- O Escritor não aprova o próprio texto. O Avaliador e as validações determinísticas podem pedir revisão ou bloquear a promoção.

Um resultado bloqueado é uma proteção, não um roteiro final. Corrija ou tente novamente; não force a cópia de um texto parcial para **Scripts Finais**.

## Automação técnica pelo PowerShell

O runner abaixo é a forma de auditoria operacional usada nos testes. Ele não é necessário para o uso normal pela interface.

```powershell
Set-Location "C:\caminho\dna-viral"
$env:REPORT_DIR = ".runtime\viral-preset-live\meu-video-01"
& .\scripts\run-target-preset-live.ps1 -TargetVideoPath "C:\caminho\video.mp4"
```

O runner faz upload privado, análise visual/transcrição, aplicação do preset, ciclo Escritor ↔ Avaliador, validação formal e promoção. Ele grava checkpoint, relatório JSON e resumo Markdown dentro de `REPORT_DIR`, sem colocar transcrição ou descrições brutas de frames nesses relatórios.

Para usar um preset específico, defina o ID antes da execução:

```powershell
$env:TARGET_PRESET_ID = "ID-DO-PRESET"
$env:TARGET_LANGUAGE = "pt-BR"
```

Para retomar **o mesmo vídeo, preset e diretório de relatório** depois de uma falha transitória:

```powershell
& .\scripts\run-target-preset-live.ps1 -TargetVideoPath "C:\caminho\video.mp4" -NoReset
```

Use um `REPORT_DIR` novo para outro vídeo ou para uma execução independente. Sem `-NoReset`, o runner começa uma execução limpa. Com `-NoReset`, ele reaproveita somente checkpoints válidos e ainda consulta o banco como fonte de verdade.

### Automatizar uma pasta inteira de vídeos

O exemplo abaixo executa os arquivos em sequência, cria um relatório separado para cada um e reduz conflitos de cota:

```powershell
Set-Location "C:\caminho\dna-viral"
$env:TARGET_PRESET_ID = "ID-DO-PRESET"
$env:TARGET_LANGUAGE = "pt-BR"
$videos = Get-ChildItem "C:\caminho\meus-videos" -File | Where-Object Extension -In ".mp4", ".mov", ".webm", ".avi"

foreach ($video in $videos) {
  $safeName = [IO.Path]::GetFileNameWithoutExtension($video.Name) -replace '[^a-zA-Z0-9_-]', '-'
  $env:REPORT_DIR = ".runtime\viral-preset-live\lote-$safeName"
  & .\scripts\run-target-preset-live.ps1 -TargetVideoPath $video.FullName
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Bloqueado ou falhou: $($video.FullName)"
  }
}
```

Uma falha não deve ser transformada à força em roteiro final. Guarde o relatório do item, corrija a causa ou rode novamente esse arquivo. Para repetir somente um item após falha transitória, mantenha o mesmo `REPORT_DIR` e use `-NoReset`.

### Baixar uma lista de links e depois analisar

Para automação fora da interface, salve um link por linha em `links.txt`. Baixe apenas material que você tem direito de usar:

```powershell
Set-Location "C:\caminho\dna-viral"
New-Item ".runtime\downloads-lote" -ItemType Directory -Force
$links = Get-Content ".\links.txt" | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') }

foreach ($link in $links) {
  yt-dlp --no-playlist --windows-filenames --js-runtimes node --retries 10 --fragment-retries 10 -f "bv*+ba/b" --merge-output-format mp4 -o ".runtime/downloads-lote/%(id)s.%(ext)s" $link
}
```

Depois, use o loop da pasta acima apontando para `.runtime\downloads-lote`. Na interface, o equivalente mais simples é colar todos os links em `/old-home` para formar a base ou em `/app` para gerar em vários vídeos novos.

O Supabase CLI precisa estar autenticado e a conta precisa ter acesso ao projeto. O wrapper obtém a chave de serviço em memória e a remove do ambiente ao finalizar. Nunca cole essa chave no comando, no frontend, em `.env` público, relatório ou documentação.

## Dependências

- Node.js e npm compatíveis com o projeto.
- Supabase CLI autenticado para o runner técnico e deploys.
- Supabase Storage e Edge Functions do projeto acessíveis.
- Secrets do provedor Gemini configurados somente no backend.
- `ffmpeg` e `ffprobe` disponíveis para normalização/análise de arquivos.
- `yt-dlp` e o helper local para baixar links suportados.
- Conexão de rede e cota disponível nos provedores.

Lovable AI não é dependência do pipeline atual. Codex também não precisa permanecer aberto como servidor: ele é usado para desenvolvimento, auditoria e manutenção.

O motor de produção é composto pelas Edge Functions do Supabase, Gemini configurado no backend, análise visual/transcrição, banco e Storage. O Codex não fica “dentro” de cada geração futura; as regras que ele implementou ficam no código publicado e são executadas automaticamente pelo backend.

## Tempo esperado

Não existe um prazo fixo por vídeo. O tempo varia com duração e tamanho do arquivo, velocidade do link, download da plataforma, normalização, quantidade de frames, fila e cota da IA.

- Uma retomada ou execução que reaproveita artefatos já prontos pode terminar perto de 1–2 minutos nas condições observadas.
- Um vídeo novo, com download, upload, transcrição e análise visual completos, normalmente leva mais e pode demorar vários minutos.
- Arquivos entre 45 e 300 MB e lotes de muitos links tendem a demorar mais.
- O lote é sequencial; adicionar mais itens aumenta o tempo total.

Esses números são referência operacional, não SLA. A qualidade dos próximos roteiros tende a ficar mais consistente quando o preset contém exemplos realmente próximos do formato, mas nenhum sistema pode prometer viralização ou superioridade automática em todo vídeo.

Os próximos itens do mesmo lote costumam ser mais simples de operar porque preset, servidor e fluxo já estão configurados, mas cada vídeo novo ainda precisa de download/upload, frames, OCR, transcrição quando houver, Escritor e Avaliador. Portanto, “já saber as regras” melhora consistência e reduz trabalho manual; não elimina o tempo de análise nem garante que todo arquivo passe na primeira tentativa.

## Retomada e solução de erros

1. Identifique o estágio exibido: download, upload, áudio, visual, Escritor, Avaliador, validação ou promoção.
2. Para timeout, HTTP 429, rede ou indisponibilidade temporária, tente novamente uma vez ou retome o mesmo item.
3. Para arquivo acima de 45 MB, confirme que o app foi aberto por `localhost` e que o helper local está ativo.
4. Para HTTP 413, confirme que o arquivo tem no máximo 300 MB e deixe a preparação local terminar.
5. Para link privado, removido, bloqueado por região/idade ou não suportado pelo `yt-dlp`, use um arquivo local obtido legalmente.
6. Em `writer_error` ou bloqueio factual repetido, não force aprovação: o contrato do roteiro não foi atendido e precisa de correção.
7. No runner, use `-NoReset` apenas com o mesmo vídeo e `REPORT_DIR`; guarde o ID da assembly e o caminho do relatório.
8. Se a interface não abrir, inicie `DNAViralDevServer` e confirme HTTP 200 antes de reenviar o trabalho.

## Métricas e limites honestos

As porcentagens de continuação, skip e duração média mostradas antes da publicação são **estimativas comparativas de IA**. Elas ajudam a revisar gancho, ritmo e payoff, mas não medem comportamento real do público e não garantem `+86%` de continuação, menos de `10%` de skip ou `+90%` de duração média.

Somente o YouTube, depois da publicação e com amostra suficiente, fornece as métricas reais. A análise visual e a transcrição também podem errar; para uma publicação importante, confira o roteiro contra o vídeo antes de publicar.

## Segurança

Chaves de API que já foram coladas em conversas devem ser revogadas e recriadas. Mantenha rotação e limites no backend. Nunca exponha `service_role` ou chaves de IA no navegador, em prints, commits ou relatórios.
