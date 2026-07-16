# Workflow reproduzível: DNA Viral + DublaTudo

Este documento descreve o contrato público do fluxo usado para transformar um
conjunto de referências em uma estratégia narrativa reutilizável e aplicar essa
estratégia a um vídeo novo. Ele não contém vídeos, transcrições privadas,
identificadores de canais, credenciais ou dados do ambiente original.

O objetivo é reproduzir **estratégias** — abertura, progressão, tensão,
micro-revelações, payoff, ritmo e relação entre fala e imagem — sem copiar o
texto de uma referência.

## Visão geral

```text
Referências
  → transcrição + amostragem visual temporal
  → unidades narrativas e padrões de gancho
  → Preset DNA consolidado
  → análise visual do vídeo novo
  → Escritor DNA ↔ Avaliador Viral
  → roteiro final congelado
  → narração contínua
  → compactação de silêncio
  → retime global do vídeo
  → recorte em duas camadas
  → legendas + CTA + mixagem
  → gates técnico e visual
  → fila de entrega retomável
```

Cada etapa produz um artefato verificável. Uma falha não deve apagar artefatos
aprovados nem obrigar o lote inteiro a recomeçar.

## 1. Construção do Preset DNA

### 1.1 Ingestão e normalização

1. Receba arquivos ou uma lista de links de vídeos individuais.
2. Normalize contêiner, resolução, orientação, taxa de quadros e áudio antes da
   análise.
3. Gere uma chave estável por fonte e deduplique a fila.
4. Guarde o original separadamente dos derivados. Os derivados podem ser
   recriados; o original não deve ser sobrescrito.

### 1.2 Evidência falada e visual

A análise deve usar duas linhas do tempo sincronizadas:

- **fala:** transcrição com palavras ou blocos marcados por tempo;
- **imagem:** frames distribuídos por toda a duração, com amostragem mais densa
  nos primeiros segundos, mudanças de cena, viradas e payoff.

O título e a descrição da plataforma servem apenas como metadados auxiliares.
O gancho real é o que é falado e mostrado no começo do vídeo. Nunca use o título
como substituto da transcrição.

Para cada referência, registre pelo menos:

- ação e objeto visíveis na abertura;
- texto exato do gancho falado e sua duração;
- premissa revelada e informação deliberadamente retida;
- sequência de setup, desenvolvimento, tensão, virada e payoff;
- micro-revelações e distância entre elas;
- ritmo de fala, tamanho das frases e vocabulário recorrente;
- emoção dominante por bloco;
- relação entre cada frase e a cena correspondente;
- posição e tipo de CTA, quando houver.

### 1.3 Consolidação

O Preset DNA deve guardar padrões abstratos e exemplos rastreáveis, não um
roteiro pronto. Uma consolidação útil contém:

- famílias de gancho e condições visuais em que funcionam;
- estruturas dominantes de desenvolvimento e payoff;
- ritmo observado e distribuição de tamanho das frases;
- palavras de alta recorrência ou engajamento;
- curva de tensão e frequência de micro-revelações;
- regras negativas, como não antecipar a virada no gancho;
- idioma e quantidade de evidências que sustentam cada padrão.

Um padrão sem evidência suficiente deve ser marcado como incerto. O sistema não
deve preencher lacunas silenciosamente com uma estratégia genérica.

## 2. Aplicação a um vídeo novo

### 2.1 A imagem é a fonte principal

Primeiro construa uma linha do tempo do vídeo novo: personagens, objetos, ações,
mudanças de estado, conflito, surpresa e desfecho. A transcrição existente, se
houver, ajuda a explicar a cena, mas não pode contradizer o que é visível.

O mesmo processo atende formatos diferentes:

- vídeo com narração: preserve fatos úteis da fala e corrija estrutura e ritmo;
- vídeo sem voz: derive a história das ações visíveis;
- react: separe a reação da mídia reagida e descreva qual delas sustenta cada
  afirmação;
- história já narrada: reorganize sem inventar eventos ausentes dos frames.

### 2.2 Gancho adaptado, não copiado

O gancho deve reutilizar a mecânica aprendida no preset e trocar sujeito,
objeto, risco e consequência pelo contexto real do vídeo novo. Nos primeiros
três a cinco segundos:

- comece pela ação concreta mais forte já comprovada nos frames iniciais;
- abra uma lacuna de curiosidade sem revelar a virada ou o final;
- use linguagem cotidiana, curta e oral;
- não invente intenção, vítima, perigo ou relação ainda não demonstrada;
- não resuma a história inteira;
- não use promessas genéricas que poderiam servir para qualquer vídeo.

Quando nenhuma família de gancho for compatível, gere uma variação nova a partir
das propriedades consolidadas do preset e registre que houve composição, em vez
de fingir que existia um modelo idêntico.

### 2.3 Escritor e Avaliador

O Escritor produz roteiro e mapa cena-frase. O Avaliador verifica, de forma
independente:

- fidelidade factual e visual;
- força e clareza do gancho;
- curiosidade sem spoiler;
- progressão e micro-revelações;
- sincronização prevista com as cenas;
- naturalidade do idioma e da fala;
- payoff e fechamento;
- adequação da CTA.

Reprove o rascunho quando houver frase sem suporte visual, evento fora de ordem,
gancho genérico, antecipação do desfecho ou quebra de idioma. A revisão termina
somente quando todos os critérios obrigatórios passam. Métricas de retenção são
metas editoriais, nunca uma garantia de desempenho da plataforma.

Depois da aprovação, congele texto, idioma, pontuação e mapa temporal. A etapa de
edição não deve reescrever o roteiro implicitamente.

## 3. Narração contínua e compactação

Gere a narração final em **uma única síntese contínua**. Isso conserva voz,
emoção, pronúncia e prosódia entre frases. Sintetizar cada trecho separadamente
tende a criar sílabas residuais, mudanças de timbre e pausas artificiais.

Antes da montagem:

1. valide se o texto sintetizado é exatamente o roteiro congelado;
2. remova apenas ruído ou silêncio real das extremidades;
3. detecte vales de silêncio entre falas;
4. una os trechos de fala com `gap = 0` e `fade = 0`;
5. preserve a velocidade e o timbre da voz em `1.0x`;
6. remapeie os tempos de palavras e frases para a linha do tempo compactada.

O corte precisa acontecer em regiões silenciosas e não dentro de fonemas. O
artefato resultante é uma faixa de narração contínua e compacta; as legendas são
derivadas desse novo mapa, não dos tempos anteriores ao corte.

## 4. Retime global do vídeo

Compare a duração útil do vídeo com a duração da narração compactada. Faça um
único retime global do vídeo para que ambos terminem juntos:

```text
fator_de_tempo = duração_da_narração / duração_útil_do_vídeo
```

O fator é aplicado à linha do tempo visual inteira. Não acelere uma cena por
frase e não altere a voz para perseguir o vídeo, pois isso produz saltos de
ritmo e dessincronização acumulada. Se o fator necessário sair do intervalo de
qualidade definido pelo projeto, devolva o item ao Escritor para encurtar ou
expandir o roteiro.

## 5. Remoção da legenda antiga por recorte

O método público usa somente **recorte em duas camadas**, sem inpainting:

1. detecte a faixa nítida que contém a imagem principal;
2. exclua título, barras pretas e a faixa persistente da legenda antiga;
3. crie o fundo a partir de uma cópia da própria faixa limpa, ampliada e
   desfocada;
4. centralize por cima a faixa limpa, sem blur e com bordas definidas;
5. preserve proporção e preencha o quadro vertical sem barras laterais.

O detector deve procurar uma região horizontal persistente, não apenas o maior
pico de contraste. Texto antigo e transições de blur também geram bordas fortes,
mas não podem ser escolhidos como conteúdo principal.

Esse procedimento não reconstrói pixels ocultos. Se a legenda estiver sobre uma
parte indispensável da cena, o item precisa de decisão editorial ou de outra
fonte limpa; o pipeline não deve fingir que recuperou informação inexistente.

## 6. Legendas, CTA e mixagem

### Legendas novas

- gere os blocos a partir dos tempos compactados da narração;
- limite a quantidade de palavras por tela;
- mantenha a legenda centralizada na área segura;
- garanta contraste, contorno e tamanho consistentes;
- não cubra rosto, objeto decisivo ou ação usada pelo roteiro.

### CTA próxima de 80%

A CTA é inserida em uma emenda segura próxima de 80% da duração final. A ordem de
preferência é:

1. fim de bloco narrativo;
2. pontuação forte;
3. intervalo real entre palavras.

Vídeo e áudio da CTA formam uma única unidade e entram no mesmo ponto. Nunca
insira só a imagem ou só o áudio. O gate operacional pode aceitar uma janela
curta em torno de 80% para evitar cortar uma palavra ou interromper a virada.

### Mixagem

- voz principal: referência `1.0`, sem time-stretch;
- áudio/música de fundo: ganho relativo `1.10` antes da normalização final;
- CTA: inteligível e coerente com o nível da narração;
- saída: sem clipping e com loudness consistente entre itens do lote.

O valor `1.10` é um multiplicador linear do estágio de mixagem, não uma meta de
loudness. A normalização e o limitador final ainda precisam impedir clipping.

## 7. Gates de qualidade

### Gate técnico obrigatório

Um item só pode avançar quando passar em todos os pontos aplicáveis:

- contêiner abre e decodifica até o último frame;
- resolução, proporção, FPS e streams estão corretos;
- duração de áudio e vídeo está dentro da tolerância;
- não existem buracos, sobreposições ou silêncio artificial entre frases;
- CTA está na janela aceita e possui áudio e vídeo;
- legenda tem tempos válidos, sem blocos negativos ou fora da duração;
- não há barras pretas persistentes nem faixa da legenda antiga;
- voz não clipa e a música respeita a configuração;
- hash, tamanho e caminho relativo correspondem ao manifesto do job.

### Gate visual obrigatório

Gere, no mínimo:

- contact sheet distribuída pela duração inteira;
- frame da abertura;
- frame imediatamente antes, durante e depois da CTA;
- frame do payoff;
- amostras com as maiores legendas.

A inspeção deve confirmar enquadramento central, nitidez da camada principal,
legibilidade, continuidade de cena e correspondência entre fala e imagem. Um
teste técnico aprovado não substitui essa inspeção.

### Gate editorial final

Leia o roteiro acompanhando a contact sheet ou o vídeo em baixa resolução. Se a
fala descreve algo que já passou ou ainda não apareceu, ajuste o mapa/roteiro e
renderize novamente. Não corrija erro de sincronização apenas deslocando todas
as legendas.

## 8. Fila retomável e idempotente

Cada combinação de fonte, idioma, preset e versão de configuração recebe uma
chave de job estável. O manifesto deve registrar:

```json
{
  "job_key": "hash-estavel",
  "status": "pending | running | pass | fail",
  "stage": "script | voice | compact | render | qa | delivery",
  "input_hash": "...",
  "config_version": "...",
  "artifacts": {},
  "checks": {},
  "error": null
}
```

Regras de retomada:

- grave artefatos em arquivo temporário e promova-os atomicamente ao concluir;
- um item `pass` com hash compatível é reutilizado;
- um item `fail` recomeça no primeiro estágio inválido;
- mudança de roteiro invalida voz, tempos, render e QA;
- mudança apenas de metadata de publicação não invalida o vídeo;
- nunca trate uma fila parcialmente criada como lote completo;
- valide o lote inteiro antes de qualquer publicação externa;
- somente itens com gate técnico, visual e editorial aprovados entram na fila de
  entrega.

Uma execução interrompida pode ser iniciada novamente com o mesmo manifesto. O
processo deve pular artefatos aprovados e continuar pelos faltantes, sem gerar
duplicatas.

## 9. Configuração de referência

Os nomes abaixo são ilustrativos e não contêm segredos:

```yaml
workflow_version: 1
script:
  visual_priority: true
  hook_window_seconds: [3, 5]
  require_writer_evaluator_pass: true
voice:
  synthesis_mode: continuous
  speed: 1.0
silence_compaction:
  gap_seconds: 0
  fade_seconds: 0
video:
  retime_mode: global_once
subtitle_removal:
  method: two_layer_crop
  inpainting: false
captions:
  timing_source: compacted_words
cta:
  target_ratio: 0.80
  require_audio_and_video: true
mix:
  voice_gain: 1.0
  background_gain: 1.10
qa:
  full_decode: true
  contact_sheet: true
  cta_evidence_frames: true
queue:
  resumable: true
  skip_matching_pass: true
```

Segredos de provedores devem ficar no backend ou no cofre de segredos. Nunca os
inclua no manifesto, nos relatórios de QA, no repositório ou em variáveis
expostas ao navegador.

## 10. Checklist de entrega

- [ ] Preset sustentado por fala e frames, não por títulos.
- [ ] Gancho adaptado ao que aparece nos primeiros segundos e sem spoiler.
- [ ] Roteiro e mapa cena-frase aprovados pelo Escritor/Avaliador.
- [ ] Narração criada em uma síntese contínua.
- [ ] Silêncios compactados com gap e fade zero, sem cortar fonemas.
- [ ] Vídeo submetido a um único retime global.
- [ ] Legenda antiga removida por recorte em duas camadas, sem inpainting.
- [ ] Legendas novas derivadas dos tempos compactados.
- [ ] CTA completa posicionada em emenda segura próxima de 80%.
- [ ] Música em ganho relativo 1.10 e saída sem clipping.
- [ ] Decode completo e gates técnico, visual e editorial aprovados.
- [ ] Manifesto retomável íntegro antes da fila de entrega.

Este fluxo melhora consistência e observabilidade. Ele não promete viralização:
distribuição, audiência, tema, concorrência e comportamento da plataforma
continuam fora do controle do pipeline.
