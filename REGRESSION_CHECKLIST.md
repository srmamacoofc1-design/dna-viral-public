# CHECKLIST DE REGRESSÃO — ViralDNA

## Quando executar
- **OBRIGATÓRIO antes de cada deploy**
- Após qualquer alteração em Edge Functions
- Após qualquer alteração no DashboardSidebar
- Após qualquer alteração em páginas do pipeline

---

## TESTES AUTOMATIZADOS (vitest)

Executar: `npx vitest run src/test/regression/`

### 1. Pipeline Data Integrity (`pipeline-data.test.ts`)
| Caso | Resultado Esperado | Bloqueia Deploy? |
|------|-------------------|-----------------|
| DNA Object com status=ready existe | ≥1 registro | **SIM** |
| Template Context com status=ready existe | ≥1 registro | **SIM** |
| Blueprint Context com status=ready existe | ≥1 registro | **SIM** |
| Generation Context com status=ready existe | ≥1 registro | **SIM** |
| Cadeia DNA→Template→Blueprint está linkada | source_ids preenchidos | **SIM** |
| promoted_scripts tem ≥1 registro | registro existe | **SIM** |
| Script promovido tem script_text >50 chars | texto não vazio | **SIM** |
| Script promovido tem ≥3 blocos | script_blocks populado | **SIM** |
| Script promovido tem validation_status=approved | status correto | **SIM** |
| Script promovido referencia assembly real | FK válida | **SIM** |
| Assemblies com validação executada existem | ≥1 com validation_status | **SIM** |
| Resultado de validação contém slot_validations | estrutura correta | **SIM** |
| Contadores do Overview > 0 (videos, assemblies, gen_contexts) | dados reais | **SIM** |

### 2. Navigation (`navigation.test.ts`)
| Caso | Resultado Esperado | Bloqueia Deploy? |
|------|-------------------|-----------------|
| 9 rotas placeholder NÃO aparecem no sidebar | ausentes do código | **SIM** |
| 12 rotas de produção aparecem no sidebar | presentes no código | **SIM** |

### 3. Overview UI (`overview-ui.test.tsx`)
| Caso | Resultado Esperado | Bloqueia Deploy? |
|------|-------------------|-----------------|
| Página renderiza título "Overview" | texto visível | **SIM** |
| Código não contém labels fake ("Fase 2", "em preparação") | ausentes | **SIM** |

### 4. Promoted Scripts UI (`promoted-scripts-ui.test.tsx`)
| Caso | Resultado Esperado | Bloqueia Deploy? |
|------|-------------------|-----------------|
| Página renderiza título "Promoted Scripts" | texto visível | **SIM** |
| Código não usa localStorage/sessionStorage | ausente | **SIM** |
| Código consulta tabela promoted_scripts | presente | **SIM** |

---

## TESTES MANUAIS (pré-deploy)

### M1 — Pipeline Completo via UI
| Step | Ação | Resultado Esperado | Bloqueia Deploy? |
|------|------|-------------------|-----------------|
| M1.1 | Abrir /dashboard/script-engine | Página carrega sem erro | **SIM** |
| M1.2 | Selecionar modo "Gerar de Tema" | Input de tema aparece | **SIM** |
| M1.3 | Preencher tema e clicar "Executar" Step 1 | Status muda para READY | **SIM** |
| M1.4 | Executar Step 2 (Assemble) | Status muda para READY | **SIM** |
| M1.5 | Executar Step 3 (Validate) | Status = approved ou needs_revision | **SIM** |
| M1.6 | Se needs_revision: Executar Step 4 (Revise) → Step 3 novamente | Loop até approved | NÃO |
| M1.7 | Executar Step 5 (Promote) | Mensagem de sucesso | **SIM** |
| M1.8 | Abrir /dashboard/promoted | Novo script aparece na lista | **SIM** |

### M2 — Promoted Scripts sem Sessão
| Step | Ação | Resultado Esperado | Bloqueia Deploy? |
|------|------|-------------------|-----------------|
| M2.1 | Abrir /dashboard/promoted em aba nova | Scripts carregam do banco | **SIM** |
| M2.2 | Clicar "Abrir" em qualquer script | Dialog mostra texto completo | **SIM** |
| M2.3 | Verificar blocos no dialog | Lista de blocos com texto | **SIM** |

### M3 — Overview Contadores
| Step | Ação | Resultado Esperado | Bloqueia Deploy? |
|------|------|-------------------|-----------------|
| M3.1 | Abrir /dashboard | Contadores numéricos visíveis | **SIM** |
| M3.2 | Verificar que nenhum contador = 0 hardcoded | Valores > 0 | **SIM** |
| M3.3 | Verificar status DNA chain | Badges "Ready" visíveis | NÃO |

### M4 — DNA Chain
| Step | Ação | Resultado Esperado | Bloqueia Deploy? |
|------|------|-------------------|-----------------|
| M4.1 | Abrir /dashboard/dna-engine/build | Página carrega com dados | **SIM** |
| M4.2 | Verificar DNA Object status = Ready | Badge verde | **SIM** |
| M4.3 | Abrir /dashboard/templates | Templates listados | **SIM** |
| M4.4 | Abrir /dashboard/blueprints/view | Blueprints listados | **SIM** |

---

## FALHAS QUE BLOQUEIAM DEPLOY

1. Qualquer teste automatizado falhando
2. Pipeline incapaz de gerar context → assembly
3. Validação sempre retornando erro (não needs_revision, mas erro real)
4. Promoção falhando com assembly aprovado
5. /dashboard/promoted não carregando scripts do banco
6. Contadores do Overview todos zerados
7. Rotas placeholder aparecendo no menu

## FALHAS QUE NÃO BLOQUEIAM DEPLOY

1. Validação retornando needs_revision (comportamento normal do validador)
2. Revisão não atingindo approved (limitação do modelo de IA)
3. Contadores específicos zerados (ex: sem cohorts — feature opcional)
