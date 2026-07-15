FROM node:22-bookworm-slim

ARG YT_DLP_VERSION=2026.06.09

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-pip \
  && python3 -m pip install --break-system-packages --no-cache-dir "yt-dlp==${YT_DLP_VERSION}" \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app /data/dna-ytdlp-worker \
  && chown -R node:node /app /data

WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    TMP_ROOT=/data/dna-ytdlp-worker

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
