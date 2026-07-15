# BASELINE DE PRODUÇÃO — VidSense Craft

**Data da homologação:** 2026-04-07  
**Resultado da suíte de regressão:** 40/40 (0 falhas)  
**Status:** BASELINE ESTÁVEL — APROVADO PARA PRODUÇÃO

---

## 1. Suíte de Regressão Oficial

**Comando obrigatório pré-deploy:**

```bash
npx vitest run src/test/regression/
```

| Arquivo | Testes | Foco |
|---------|--------|------|
| `pipeline-data.test.ts` | 15 | Integridade real no banco (DNA → Promoção) |
| `navigation.test.ts` | 21 | Rotas obrigatórias vs. rotas banidas no sidebar |
| `overview-ui.test.tsx` | 2 | Contadores reais, sem labels fake |
| `promoted-scripts-ui.test.tsx` | 2 | Scripts do banco, sem sessão local |

---

## 2. Rotas Aprovadas para Produção (12)

| Rota | Função |
|------|--------|
| `/dashboard` | Overview — contadores reais do banco |
| `/dashboard/dna-engine/build` | Gerar DNA Object |
| `/dashboard/dna-engine/view` | Visualizar DNA Objects |
| `/dashboard/templates` | Listar/criar Template Contexts |
| `/dashboard/blueprints/view` | Visualizar Blueprints |
| `/dashboard/blueprints/history` | Histórico de Blueprints |
| `/dashboard/script-engine` | Pipeline completo (Context → Promote) |
| `/dashboard/promoted` | Scripts promovidos — leitura do banco |
| `/dashboard/generation` | Gerar Generation Context |
| `/dashboard/generation/history` | Histórico de Generation Contexts |
| `/dashboard/script-assembly` | Histórico de Script Assemblies |
| `/dashboard/validation/results` | Resultados de validação |

---

## 3. Edge Functions Aprovadas (pipeline principal)

| Edge Function | Papel no pipeline |
|---------------|-------------------|
| `build-complete-generation-context` | Gerar contexto de geração |
| `assemble-script` | Montar script a partir do contexto |
| `validate-script-against-dna` | Validar script contra DNA formal |
| `revise-script-assembly` | Revisar script com feedback |
| `promote-script-final` | Promover script para tabela final |
| `generate-dna-base` | Gerar DNA Object |
| `formalize-dna-v2` | Formalizar DNA Base V2 |

---

## 4. Tabelas Críticas Aprovadas

| Tabela | Registros | Papel |
|--------|-----------|-------|
| `dna_objects` | 7 | Base do DNA narrativo |
| `template_contexts` | 3 | Templates derivados do DNA |
| `blueprint_contexts` | 2 | Blueprints derivados dos templates |
| `generation_contexts` | 26 | Contextos de geração |
| `script_assemblies` | 58 | Scripts montados |
| `promoted_scripts` | 3 | Scripts finais promovidos |

---

## 5. Fluxo Ponta a Ponta Homologado

```
DNA Object (ready)
  → Template Context (ready)
    → Blueprint Context (ready)
      → Generation Context (ready)
        → Script Assembly (assembled)
          → Validation (approved)
            → Promoted Script (final)
```

---

## 6. IDs Reais da Última Homologação (2026-04-07)

| Artefato | ID |
|----------|----|
| Generation Context | `ID-REMOVIDO-NA-COPIA-PUBLICA` |
| Script Assembly | `ID-REMOVIDO-NA-COPIA-PUBLICA` |
| Promoted Script | `ID-REMOVIDO-NA-COPIA-PUBLICA` |
| Validation Status | `approved` |

### Homologações anteriores confirmadas

| Promoted Script ID | Data | Status |
|--------------------|------|--------|
| `ID-REMOVIDO-NA-COPIA-PUBLICA` | 2026-04-07 00:08 | approved |
| `ID-REMOVIDO-NA-COPIA-PUBLICA` | 2026-04-07 02:53 | approved |
| `ID-REMOVIDO-NA-COPIA-PUBLICA` | 2026-04-07 13:21 | approved |

---

## 7. Política de Deploy

### Regras absolutas

1. **Nenhum deploy sem rodar `npx vitest run src/test/regression/`**
2. **Qualquer falha bloqueia merge e deploy**
3. **Qualquer nova feature deve preservar esta baseline**
4. **Nenhuma rota placeholder pode ser adicionada ao sidebar**
5. **Nenhum dado de sessão local pode substituir leitura do banco**

### O que NÃO pode ser quebrado

- Pipeline completo: Context → Assemble → Validate → Promote
- Persistência em `promoted_scripts` com `script_text`, `script_blocks` e `promotion_trace`
- Sidebar com exatamente 12 rotas de produção
- Overview com contadores reais do banco
- Promoted Scripts carregando do banco sem dependência de sessão
- Cadeia DNA → Template → Blueprint → Generation com registros linkados

### Rotas banidas (não podem retornar ao sidebar)

```
/dashboard/dna-engine/compare
/dashboard/reports/viral
/dashboard/reports/dna
/dashboard/reports/performance
/dashboard/database
/dashboard/settings
/dashboard/templates/create
/dashboard/templates/edit
/dashboard/blueprints/generate
```

---

## 8. Checklist Manual Complementar

Ver `REGRESSION_CHECKLIST.md` para validação manual obrigatória.

---

**Este documento é o registro oficial da baseline de produção.**  
**Qualquer alteração que quebre os 40 testes automatizados invalida o deploy.**
