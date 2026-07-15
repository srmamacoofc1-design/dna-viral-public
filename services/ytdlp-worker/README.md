# Worker privado yt-dlp do DNA Viral

Este serviço implementa exatamente o contrato consumido por
`supabase/functions/download-video/index.ts`: recebe uma URL de vídeo individual
do YouTube, baixa o arquivo com o binário real `yt-dlp` e devolve uma URL HTTPS
temporária apontando para os bytes servidos pelo próprio worker.

## Contrato HTTP

Requisição autenticada:

```http
POST /v1/resolve
Authorization: Bearer <YTDLP_SERVICE_TOKEN>
Content-Type: application/json

{
  "url": "https://www.youtube.com/shorts/vjqsNKq05iE",
  "format": "best[height<=720][ext=mp4]/best[height<=720]/best"
}
```

Resposta:

```json
{
  "download_url": "https://worker.example/v1/files/...?...",
  "content_type": "video/mp4",
  "size_bytes": 12345678,
  "expires_at": "2026-07-13T12:34:56.000Z"
}
```

`download_url` não exige o Bearer token porque a função Supabase não o reenvia ao
baixar o arquivo. A URL é protegida por HMAC, expira e só referencia um arquivo
temporário já validado. `GET`, `HEAD` e requests com um único `Range` são aceitos.

O worker recusa canais, playlists, hosts não oficiais, URLs com credenciais,
IDs inválidos e formatos fora da lista permitida. A URL é canonicalizada antes de
ser entregue ao `yt-dlp`; o processo usa `spawn` com `shell: false` e argumentos
separados. `--no-playlist` é aplicado novamente na execução.

## Rodar testes

Não há dependências npm externas:

```bash
cd services/ytdlp-worker
npm test
```

## Rodar localmente

Em desenvolvimento, `PUBLIC_BASE_URL` pode usar HTTP. O host precisa ter Node 22+,
`yt-dlp` e `ffmpeg` disponíveis:

```bash
cd services/ytdlp-worker
export YTDLP_SERVICE_TOKEN='um-segredo-aleatorio-com-no-minimo-32-caracteres'
export PUBLIC_BASE_URL='http://127.0.0.1:8787'
npm start
```

No PowerShell:

```powershell
$env:YTDLP_SERVICE_TOKEN='um-segredo-aleatorio-com-no-minimo-32-caracteres'
$env:PUBLIC_BASE_URL='http://127.0.0.1:8787'
npm start
```

Teste de saúde: `GET http://127.0.0.1:8787/healthz`.

## Container

O Dockerfile inclui Node, `yt-dlp` e `ffmpeg`, executa como usuário sem privilégios
e grava somente em `/data/dna-ytdlp-worker`:

```bash
docker build -t dna-viral-ytdlp-worker services/ytdlp-worker
docker run --rm -p 8787:8787 \
  -e YTDLP_SERVICE_TOKEN='um-segredo-aleatorio-com-no-minimo-32-caracteres' \
  -e PUBLIC_BASE_URL='https://worker.example.com' \
  -v ytdlp-worker-data:/data \
  dna-viral-ytdlp-worker
```

O processo interno fala HTTP. Em produção, publique-o atrás do TLS gerenciado da
plataforma ou de um reverse proxy e defina `PUBLIC_BASE_URL` com a origem HTTPS
externa. O serviço se recusa a iniciar com `PUBLIC_BASE_URL=http://...` quando
`NODE_ENV=production`.

Como os arquivos e o índice de URLs assinadas são efêmeros e locais ao processo,
use **uma réplica** por deployment. Para escalar horizontalmente, substitua a etapa
de retenção local por object storage compartilhado; balancear várias réplicas sem
storage compartilhado pode enviar o `GET /v1/files/...` a uma instância que não
possui o arquivo.

Reserve espaço temporário suficiente para a mídia e para o mux de áudio/vídeo.
Embora o arquivo final tenha teto rígido de 300 MiB, o `ffmpeg` pode manter arquivos
intermediários durante o merge. O monitor do processo também limita o uso temporário.

## Configurar o Supabase

Depois de publicar o container em uma origem HTTPS:

```bash
supabase secrets set YTDLP_SERVICE_URL=https://worker.example.com/v1/resolve
supabase secrets set YTDLP_SERVICE_TOKEN='o-mesmo-segredo-do-worker'
supabase functions deploy download-video
```

Não use `http://localhost` no segredo do Supabase: a Edge Function precisa alcançar
o worker pela internet. Não use diretamente uma URL `googlevideo.com` retornada por
`yt-dlp -g`; este worker serve os bytes no próprio domínio para evitar vínculos de IP
e cabeçalhos da origem.

## Variáveis de ambiente

| Variável | Padrão | Regra |
| --- | --- | --- |
| `YTDLP_SERVICE_TOKEN` | sem padrão | Obrigatória, mínimo de 32 caracteres |
| `PUBLIC_BASE_URL` | sem padrão | Origem HTTPS em produção, sem path/query |
| `PORT` | `8787` | Porta HTTP interna |
| `HOST` | `0.0.0.0` | Interface de escuta |
| `YT_DLP_BINARY` | `yt-dlp` | Binário controlado pelo operador |
| `TMP_ROOT` | diretório temporário do SO | Diretório privado dos jobs |
| `MAX_VIDEO_MIB` | `300` | Entre 1 e 300; nunca pode superar 300 |
| `MAX_CONCURRENT_JOBS` | `2` | Entre 1 e 8; excedente recebe HTTP 429 |
| `DOWNLOAD_TIMEOUT_MS` | `900000` | 10 s a 30 min |
| `SIGNED_URL_TTL_MS` | `900000` | 1 min a 1 h |
| `REQUEST_BODY_MAX_BYTES` | `16384` | 1 KiB a 64 KiB |

O arquivo `.env.example` contém um modelo completo sem segredos reais.
