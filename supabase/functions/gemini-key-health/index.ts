import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";
import {
  getGeminiApiKeys,
  normalizeGeminiModel,
} from "../_shared/gemini-rotation.ts";

const GEMINI_OPENAI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_CONCURRENCY = 4;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ProbePath = "openai_compatible" | "native_generate_content";
type ProbeCategory =
  | "healthy"
  | "auth_invalid"
  | "access_denied"
  | "quota_limited"
  | "request_timeout"
  | "client_rejected"
  | "provider_unavailable"
  | "network_error";

interface ProbeOutcome {
  http_status: number | null;
  category: ProbeCategory;
  latency_ms: number;
}

interface KeyProbeResult {
  index: number;
  openai_compatible: ProbeOutcome;
  native_generate_content: ProbeOutcome;
}

interface ProbeTotals {
  keys_configured: number;
  paths_tested: number;
  healthy_paths: number;
  unhealthy_paths: number;
  fully_healthy_keys: number;
  partially_healthy_keys: number;
  unhealthy_keys: number;
}

interface PublicReport {
  results: KeyProbeResult[];
  totals: ProbeTotals;
}

const probePaths: readonly ProbePath[] = [
  "openai_compatible",
  "native_generate_content",
];

function jsonResponse(payload: PublicReport, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function emptyReport(keysConfigured = 0): PublicReport {
  return {
    results: [],
    totals: {
      keys_configured: keysConfigured,
      paths_tested: 0,
      healthy_paths: 0,
      unhealthy_paths: 0,
      fully_healthy_keys: 0,
      partially_healthy_keys: 0,
      unhealthy_keys: keysConfigured,
    },
  };
}

function categoryForStatus(status: number): ProbeCategory {
  if (status >= 200 && status < 300) return "healthy";
  if (status === 401) return "auth_invalid";
  if (status === 403) return "access_denied";
  if (status === 408) return "request_timeout";
  if (status === 429) return "quota_limited";
  if (status >= 500) return "provider_unavailable";
  return "client_rejected";
}

function requestForPath(
  path: ProbePath,
  apiKey: string,
  model: string,
  signal: AbortSignal,
): { endpoint: string; init: RequestInit } {
  if (path === "openai_compatible") {
    return {
      endpoint: GEMINI_OPENAI_ENDPOINT,
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          temperature: 0,
        }),
        signal,
      },
    };
  }

  return {
    endpoint:
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    init: {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 1, temperature: 0 },
      }),
      signal,
    },
  };
}

async function probePath(
  apiKey: string,
  model: string,
  path: ProbePath,
): Promise<ProbeOutcome> {
  const startedAt = performance.now();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const request = requestForPath(path, apiKey, model, controller.signal);
    const response = await fetch(request.endpoint, request.init);
    const httpStatus = response.status;

    // A health probe needs only the status line. Cancel without reading so a
    // provider body can never enter logs, errors, or the public report.
    try {
      await response.body?.cancel();
    } catch {
      // Stream cleanup is best effort and has no bearing on key health.
    }

    return {
      http_status: httpStatus,
      category: categoryForStatus(httpStatus),
      latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  } catch {
    return {
      http_status: null,
      category: timedOut ? "request_timeout" : "network_error",
      latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  if (req.method !== "POST") return jsonResponse(emptyReport(), 405);

  try {
    const keys = getGeminiApiKeys();
    if (keys.length === 0) return jsonResponse(emptyReport(), 503);

    const model = normalizeGeminiModel(undefined);
    const slots: Array<Partial<Record<ProbePath, ProbeOutcome>>> = Array.from(
      { length: keys.length },
      () => ({}),
    );
    const totalTasks = keys.length * probePaths.length;
    let nextTask = 0;

    const worker = async () => {
      while (true) {
        const task = nextTask++;
        if (task >= totalTasks) return;
        const keyIndex = Math.floor(task / probePaths.length);
        const path = probePaths[task % probePaths.length];
        slots[keyIndex][path] = await probePath(keys[keyIndex], model, path);
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(MAX_CONCURRENCY, totalTasks) },
        () => worker(),
      ),
    );

    const results: KeyProbeResult[] = slots.map((slot, index) => ({
      index,
      openai_compatible: slot.openai_compatible!,
      native_generate_content: slot.native_generate_content!,
    }));
    const pathOutcomes = results.flatMap((result) => [
      result.openai_compatible,
      result.native_generate_content,
    ]);
    const healthyPaths = pathOutcomes.filter((item) => item.category === "healthy").length;
    const healthCounts = results.map((result) =>
      [result.openai_compatible, result.native_generate_content]
        .filter((item) => item.category === "healthy").length
    );
    const fullyHealthyKeys = healthCounts.filter((count) => count === probePaths.length).length;
    const partiallyHealthyKeys = healthCounts.filter((count) =>
      count > 0 && count < probePaths.length
    ).length;
    const totals: ProbeTotals = {
      keys_configured: results.length,
      paths_tested: pathOutcomes.length,
      healthy_paths: healthyPaths,
      unhealthy_paths: pathOutcomes.length - healthyPaths,
      fully_healthy_keys: fullyHealthyKeys,
      partially_healthy_keys: partiallyHealthyKeys,
      unhealthy_keys: results.length - fullyHealthyKeys - partiallyHealthyKeys,
    };

    return jsonResponse({ results, totals });
  } catch {
    // Fail closed without serializing an exception, request, response, model,
    // credential, or provider payload.
    return jsonResponse(emptyReport(), 500);
  }
});
