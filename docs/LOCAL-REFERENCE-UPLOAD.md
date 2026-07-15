# Upload local de referência acima de 45 MiB

O servidor de desenvolvimento expõe `POST /api/local-reference-upload` para o
modo Vídeo da geração. Ele existe porque o app aceita fontes de até 300 MiB, mas
o plano atual do Supabase recusa objetos maiores que aproximadamente 50 MiB.

Esse endpoint é registrado somente pelo plugin Vite em modo `serve`; não existe
no build estático publicado.

## Contrato HTTP

O cliente precisa criar primeiro uma linha própria em `reference_videos` com:

- `status = uploading`;
- `storage_bucket = reference-videos`;
- `storage_path = reference/{user_id}/upload-{sha256_com_40_hex}.mp4`.

Depois envia:

```http
POST /api/local-reference-upload
Authorization: Bearer <JWT da sessão Supabase>
Content-Type: video/mp4
Content-Length: <bytes do arquivo original>
X-Reference-Video-Id: <UUID da linha reservada>
X-Storage-Path: reference/<user_id>/upload-<40 hex>.mp4
X-File-Name: <encodeURIComponent(nome original)>

<bytes puros do File; não usar multipart/form-data>
```

O navegador deve enviar o objeto `File` diretamente. `XMLHttpRequest` é aceito e
permite progresso em `xhr.upload.onprogress`; `xhr.abort()` encerra a conexão,
mata o FFmpeg ativo e dispara a limpeza do diretório temporário.

Resposta de sucesso:

```json
{
  "success": true,
  "reference_video_id": "uuid",
  "reference_video": { "status": "pending" },
  "storage_bucket": "reference-videos",
  "storage_path": "reference/user/upload-....mp4",
  "file_name": "original.mov",
  "duration_seconds": 42.301,
  "source_size_bytes": 91234567,
  "size_bytes": 12345678,
  "content_type": "video/mp4",
  "normalized": true
}
```

Somente depois dessa resposta o cliente deve invocar `process-reference-video`.
A linha já estará em `pending`, apontando para o MP4 privado normalizado.

Erros usam `{ "error": "...", "retryable": boolean }` e status:

- `401`: JWT ausente ou inválido;
- `403`: linha/caminho não pertence ao usuário autenticado;
- `404`: reserva inexistente;
- `409`: reserva já mudou para uma fase incompatível;
- `411`: `Content-Length` ausente ou inválido;
- `413`: entrada acima de 300 MiB ou corpo maior que o declarado;
- `415`: corpo não identificado como vídeo;
- `422`: arquivo inválido ou normalização não verificável;
- `429`: já existe uma normalização local ativa;
- `503`: FFmpeg indisponível ou falha temporária.

## Garantias do backend

- autentica o JWT antes de ler o corpo grande;
- recebe o corpo em streaming para um diretório UUID dentro do temporário;
- nunca aceita caminho escolhido fora de `reference/{auth.uid()}`;
- usa `spawn`/`execFile` sem shell e argumentos FFmpeg fixos;
- valida vídeo, duração máxima de uma hora e presença original de áudio com
  `ffprobe`;
- não corta o vídeo; limita o maior eixo, FPS e bitrate conforme a duração;
- gera MP4 H.264/yuv420p + AAC em duas passagens, com alvo rígido de 45 MiB;
- compara a duração de entrada/saída e rejeita perda de áudio;
- envia o resultado com o próprio JWT do usuário, respeitando RLS, sem expor
  `service_role` ou qualquer chave Gemini;
- remove temporários em `finally` e limita a uma preparação grande simultânea.

O caminho `/api/local-ytdlp` usa o mesmo normalizador quando o download final
ultrapassa 45 MiB. Links menores seguem sem transcodificação desnecessária.
