# Estado dos três formatos — DNA Viral (15/07/2026)

Este é o registro atual para os formatos enviados pelo usuário. O motor aplica o preset **Base Viral — 50 Shorts Fornecidos (Jul 2026)** sem usar título como gancho e sem copiar literalmente os roteiros modeladores.

## Matriz atual

| Formato recebido | Perfil automático | Fonte factual prioritária | Situação atual |
|---|---|---|---|
| Historinha com narração | `preserve_spoken_story` | fala local + frames na ordem | prova live v17 aprovada e promovida |
| Vídeo sem fala útil/só música | `construct_visual_story` | pixels + OCR + ordem temporal | regras e regressões ativas; música/letra não prova fatos |
| React | `reaction_reframe` | planos visuais separados + fala local compatível | regras e regressões ativas; reagente não é fundido com personagem incorporado |

## Prova operacional aceita — historinha narrada

- Fonte: `4mzls0Mge1A`, 42,301 s.
- Análise: 9 segmentos falados e 29 momentos visuais.
- Reference video: `ID-REMOVIDO-NA-COPIA-PUBLICA`.
- Assembly validada: `ID-REMOVIDO-NA-COPIA-PUBLICA`.
- Script final: `ID-REMOVIDO-NA-COPIA-PUBLICA`.
- Validação: 100/100 critérios, zero falha crítica.
- Escritor ↔ Avaliador: duas iterações, `quality_gate_passed`.

Gancho aceito pelo usuário:

> Ele queria ficar deitado o dia todo. O homem desliza pela escada; até onde ficar deitado levaria ele?

Ele usa a fala e a ação dos primeiros segundos e não antecipa emprego, promoção, festa ou payoff romântico.

Estimativas pré-publicação do Avaliador: 91,2% continuariam, 8,8% pulariam e 93,5% de duração média; nota geral 9,2/10. São estimativas comparativas, não métricas reais nem garantia.

## O que acontece nos outros dois formatos

### Só música ou história visual

O sistema não usa a letra para inventar ação, relação ou motivo. Ele ordena os frames, preserva ações curtas que explicam o próximo evento e trata OCR temporal — por exemplo `um ano depois` — como parte material da história. O caso de gato/cachorro que antes omitiu captura/consumo do rato → esqueleto → ataque permanece invalidado; essa falha virou regra e teste de regressão.

### React

O sistema classifica reagente e conteúdo incorporado em planos separados. Gesto, choro, fala ou reação de uma pessoa não pode ser transferido para a outra. O resultado live antigo que misturou gesto, antecipou personagem e omitiu OCR permanece invalidado; os erros viraram guardas e testes. Isso evita apresentar o exemplo antigo como prova falsa de qualidade.

## Critério de entrega

O sistema está configurado para os três formatos e decide o perfil automaticamente. Uma saída só aparece em **Scripts Finais** depois de Escritor, Avaliador, fidelidade visual, sequência, idioma, anti-cópia e promoção. Quando um gate não consegue sustentar o texto, bloquear é o comportamento correto.

O nível de linguagem oral aceito pelo usuário inclui construções coloquiais que não seriam escolhidas para texto acadêmico. A prioridade é uma narração clara para o canal, conectada ao que é falado e principalmente ao que é mostrado.

## Onde usar

- Aplicativo: [http://localhost:8080](http://localhost:8080)
- Vídeo novo: [http://localhost:8080/app](http://localhost:8080/app)
- Base viral: [http://localhost:8080/old-home](http://localhost:8080/old-home)
- Fila: [http://localhost:8080/queue](http://localhost:8080/queue)
- Biblioteca/presets: [http://localhost:8080/library](http://localhost:8080/library)
- Automação: [GUIA-AUTOMACAO-DNA-VIRAL-2026-07-15.md](./GUIA-AUTOMACAO-DNA-VIRAL-2026-07-15.md)

