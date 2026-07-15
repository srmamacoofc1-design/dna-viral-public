import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { IngestionError } from "./ingestion.ts";

export interface EdgeActor {
  kind: "service" | "user";
  userId: string | null;
}

export class EdgeAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "EdgeAuthError";
  }
}

type ResponseHeaders = Record<string, string>;

function authFailureResponse(
  error: unknown,
  headers: ResponseHeaders,
): Response {
  let status = 500;
  let code = "AUTH_CHECK_FAILED";
  let message = "Nao foi possivel validar sua permissao agora.";
  if (error instanceof EdgeAuthError || error instanceof IngestionError) {
    status = error.status;
    code = error.code;
    message = error.message;
  }

  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function edgeCredentials(): { supabaseUrl: string; serviceRoleKey: string } {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new EdgeAuthError(
      "AUTH_CONFIG_MISSING",
      "A autenticacao do servidor nao esta configurada.",
      503,
    );
  }
  return { supabaseUrl, serviceRoleKey };
}

function bearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization") ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
}

/**
 * New Supabase projects may inject an sb_secret key as
 * SUPABASE_SERVICE_ROLE_KEY while the Edge gateway still expects the legacy
 * service-role JWT. EDGE_INTERNAL_SERVICE_TOKEN stores that JWT explicitly.
 * Only exact secret equality grants service access; token claims alone never
 * elevate a caller.
 */
function isTrustedServiceToken(token: string, serviceRoleKey: string): boolean {
  if (token === serviceRoleKey) return true;
  const internalToken = Deno.env.get("EDGE_INTERNAL_SERVICE_TOKEN")?.trim() ?? "";
  return Boolean(internalToken && token === internalToken);
}

export function internalFunctionHeaders(serviceRoleKey: string): Record<string, string> {
  const explicitInternalToken = Deno.env.get("EDGE_INTERNAL_SERVICE_TOKEN")?.trim() ?? "";
  const legacyServiceJwt = serviceRoleKey.trim().split(".").length === 3
    ? serviceRoleKey.trim()
    : "";
  const internalToken = explicitInternalToken || legacyServiceJwt;
  if (!internalToken || !serviceRoleKey.trim()) {
    throw new EdgeAuthError(
      "INTERNAL_AUTH_CONFIG_MISSING",
      "A autenticacao entre funcoes nao esta configurada.",
      503,
    );
  }
  return {
    Authorization: `Bearer ${internalToken}`,
    apikey: serviceRoleKey.trim(),
  };
}

/**
 * Autenticação comum para recursos pertencentes ao usuário. Chamadas entre
 * Edge Functions devem usar o service-role token; chamadas do navegador usam
 * o JWT da sessão e continuam sujeitas à checagem de ownership.
 */
export async function requireUserOrService(options: {
  req: Request;
  supabaseUrl: string;
  serviceRoleKey: string;
}): Promise<EdgeActor> {
  const token = bearerToken(options.req);
  if (!token) throw new EdgeAuthError("AUTH_REQUIRED", "Faça login novamente.", 401);
  if (isTrustedServiceToken(token, options.serviceRoleKey)) {
    return { kind: "service", userId: null };
  }

  const admin = createClient(options.supabaseUrl, options.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new EdgeAuthError("INVALID_AUTH", "Sua sessão expirou. Faça login novamente.", 401);
  return { kind: "user", userId: data.user.id };
}

export function assertResourceOwner(actor: EdgeActor, ownerId: string | null | undefined): void {
  if (actor.kind === "service") return;
  if (!ownerId || ownerId !== actor.userId) {
    throw new EdgeAuthError("RESOURCE_FORBIDDEN", "Você não tem permissão para acessar este recurso.", 403);
  }
}

/**
 * Authorizes a user-owned resource for its owner, an authenticated admin, or
 * an internal service-role caller. The admin lookup is deliberately performed
 * only for cross-owner access; the common owner path needs no extra query.
 */
export async function requireResourceOwnerAdminOrService(options: {
  actor: EdgeActor;
  ownerId: string | null | undefined;
  supabaseUrl: string;
  serviceRoleKey: string;
}): Promise<void> {
  if (options.actor.kind === "service") return;
  if (options.ownerId && options.ownerId === options.actor.userId) return;

  const admin = createClient(options.supabaseUrl, options.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: isAdmin, error } = await admin.rpc("has_role", {
    _user_id: options.actor.userId,
    _role: "admin",
  });
  if (error) {
    throw new EdgeAuthError(
      "ROLE_CHECK_FAILED",
      "Não foi possível validar sua permissão de administrador.",
      503,
    );
  }
  if (isAdmin !== true) {
    throw new EdgeAuthError("RESOURCE_FORBIDDEN", "Você não tem permissão para acessar este recurso.", 403);
  }
}

/**
 * Library ingestion mutates a shared, admin-owned corpus. Edge Functions use
 * the service-role token when they call each other; browser calls must belong
 * to an authenticated administrator.
 */
export async function requireLibraryAdminOrService(options: {
  req: Request;
  supabaseUrl: string;
  serviceRoleKey: string;
}): Promise<EdgeActor> {
  const token = bearerToken(options.req);
  if (!token) {
    throw new IngestionError("AUTH_REQUIRED", "Faça login novamente antes de processar o vídeo.", 401);
  }

  if (isTrustedServiceToken(token, options.serviceRoleKey)) {
    return { kind: "service", userId: null };
  }

  const admin = createClient(options.supabaseUrl, options.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    throw new IngestionError("INVALID_AUTH", "Sua sessão expirou. Faça login e tente novamente.", 401);
  }

  const { data: isAdmin, error: roleError } = await admin.rpc("has_role", {
    _user_id: userData.user.id,
    _role: "admin",
  });
  if (roleError) {
    throw new IngestionError("ROLE_CHECK_FAILED", "Não foi possível validar sua permissão de administrador.", 503, true);
  }
  if (isAdmin !== true) {
    throw new IngestionError("ADMIN_REQUIRED", "A ingestão da biblioteca é restrita a administradores.", 403);
  }
  return { kind: "user", userId: userData.user.id };
}

/**
 * Small handler guard for legacy Edge Functions. Returning a Response instead
 * of throwing keeps authentication failures out of generic catch blocks that
 * historically converted every error into HTTP 500/200.
 */
export async function authorizeUserOrServiceRequest(
  req: Request,
  headers: ResponseHeaders = {},
): Promise<Response | null> {
  try {
    const credentials = edgeCredentials();
    await requireUserOrService({ req, ...credentials });
    return null;
  } catch (error) {
    return authFailureResponse(error, headers);
  }
}

/**
 * Guard for operations over the shared viral library. Browser callers must be
 * authenticated administrators; internal function-to-function calls must use
 * the service-role token.
 */
export async function authorizeLibraryAdminOrServiceRequest(
  req: Request,
  headers: ResponseHeaders = {},
): Promise<Response | null> {
  try {
    const credentials = edgeCredentials();
    await requireLibraryAdminOrService({ req, ...credentials });
    return null;
  } catch (error) {
    return authFailureResponse(error, headers);
  }
}
