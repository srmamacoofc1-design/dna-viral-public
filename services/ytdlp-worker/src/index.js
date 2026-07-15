import { loadConfig } from "./config.js";
import { createYtdlpWorker } from "./server.js";

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`Configuração inválida: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const worker = createYtdlpWorker({ config });
worker.server.listen(config.port, config.host, () => {
  console.log(`DNA Viral yt-dlp worker ativo em ${config.host}:${config.port}`);
});

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`Recebido ${signal}; encerrando worker...`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  try {
    await worker.close();
    process.exit(0);
  } catch (error) {
    console.error("Falha ao encerrar worker", error);
    process.exit(1);
  }
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
