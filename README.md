# ViralDNA

Plataforma para extrair estratégias narrativas de vídeos virais — gancho falado,
progressão, tensão, micro-revelações, payoff, ritmo e relação entre fala e imagem —
e adaptar essas estratégias a um vídeo novo sem copiar o roteiro original.

Esta é uma cópia pública sanitizada do projeto. Ela não inclui chaves, banco de
dados, vídeos, transcrições privadas, arquivos de execução nem credenciais do
ambiente original.

## Fluxo principal

```text
Vídeos de referência por link ou upload
  → transcrição do que foi falado
  → análise minuciosa dos frames e da linha do tempo
  → extração do DNA narrativo e dos ganchos reais
  → consolidação em um Preset DNA
  → vídeo novo por link ou upload (até 300 MB)
  → geração com prioridade visual
  → Escritor DNA ↔ Avaliador Viral em ciclo de revisão
  → roteiro final promovido somente após os gates de qualidade
```

## Rodar localmente

Requisitos: Node.js 20 ou superior, npm e um projeto Supabase próprio.

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Depois, abra [http://localhost:8080](http://localhost:8080).

Preencha `.env.local` com a URL e a chave publicável do seu projeto Supabase.
Nunca coloque `service_role`, chaves Gemini ou outros segredos em variáveis
`VITE_*`, pois elas ficam visíveis no navegador.

## Preparar o backend

O frontend sozinho abre, mas o pipeline completo exige banco, autenticação,
Storage e Edge Functions no Supabase:

```powershell
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
npx supabase functions deploy
```

Configure os segredos somente no backend do Supabase, incluindo
`GEMINI_API_KEYS` (pool separado por vírgulas), e revise os serviços opcionais
descritos no guia de automação.

Depois de criar a primeira conta, promova somente o responsável pelo projeto no
SQL Editor do Supabase (troque o e-mail pelo seu):

```sql
UPDATE public.user_roles
SET role = 'admin'
WHERE user_id = (
  SELECT id FROM auth.users
  WHERE lower(email) = lower('seu-email@example.com')
  LIMIT 1
);
```

Todos os demais cadastros entram como `member` e continuam com acesso às áreas
de upload, fila, biblioteca, presets e geração, sem receber privilégios de
administração.

## Áreas do app

| Área | Rota | Acesso |
|---|---|---|
| Login | `/login` | público |
| Gerador de roteiros | `/app` | usuário autenticado |
| Adicionar vídeos e links | `/old-home` | usuário autenticado |
| Fila de processamento | `/queue` | usuário autenticado |
| Biblioteca e Presets DNA | `/library` | usuário autenticado |
| Administração e diagnóstico | `/dashboard`, `/dna-viral` e relatórios | administrador |

O menu do usuário mostra a geração, o upload por links/arquivos, a fila e a
biblioteca. As rotas técnicas continuam protegidas pelo papel de administrador.

## Documentação

- [Workflow reproduzível DNA Viral + DublaTudo](docs/WORKFLOW-DNA-DUBLATUDO-2026-07-16.md)
- [Guia completo de automação](docs/GUIA-AUTOMACAO-DNA-VIRAL-2026-07-15.md)
- [Especificação dos Presets DNA](docs/DNA-PRESETS.md)
- [Status técnico da entrega](docs/STATUS-FINAL-DNA-VIRAL-2026-07-15.md)
- [Teste dos três formatos de vídeo](docs/TESTE-TRES-FORMATOS-2026-07-15.md)

## Verificação

```powershell
npm test
npx tsc --noEmit
npm run build
```

Na entrega de 15/07/2026, o código-fonte original passou em 954/954 testes,
typecheck e build. Uma instalação nova ainda depende da configuração correta do
Supabase e dos provedores de IA do novo responsável.

## Stack

- React 18, TypeScript, Vite, Tailwind e shadcn/ui
- Supabase (Postgres, RLS, Auth, Storage e Edge Functions em Deno)
- Google Gemini no backend para transcrição/análise, geração e avaliação
- yt-dlp/FFmpeg no serviço local ou worker privado de ingestão

## Segurança da cópia pública

- `.env`, `.env.local`, dados de runtime e vídeos são ignorados pelo Git.
- `.env.example` contém apenas placeholders.
- Chaves de IA devem permanecer no cofre de segredos do Supabase.
- Cada pessoa que clonar o projeto deve usar seu próprio Supabase e suas próprias
  credenciais.
