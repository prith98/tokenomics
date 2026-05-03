import type { Request } from 'express';
import { v7 as uuidv7 } from 'uuid';
import { config } from '../config.js';
import type { Environment, GatewayRequest, Provider, RequestContext } from '../types.js';

const HEADER = {
  team: 'x-gateway-team',
  feature: 'x-gateway-feature',
  agent: 'x-gateway-agent',
  session: 'x-gateway-session',
  user: 'x-gateway-user',
  env: 'x-gateway-env',
  provider: 'x-gateway-provider',
} as const;

function header(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export function buildContext(req: Request): RequestContext {
  return {
    request_id: uuidv7(),
    team_id: header(req, HEADER.team) ?? config.defaults.teamId,
    feature_id: header(req, HEADER.feature) ?? config.defaults.featureId,
    agent_id: header(req, HEADER.agent),
    session_id: header(req, HEADER.session),
    user_id: header(req, HEADER.user),
    environment: (header(req, HEADER.env) as Environment | undefined) ?? config.defaults.environment,
  };
}

export function inferProvider(req: Request, model: string): Provider {
  const explicit = header(req, HEADER.provider);
  if (explicit === 'openai' || explicit === 'anthropic' || explicit === 'mock') return explicit;
  if (model.startsWith('claude')) return 'anthropic';
  if (model.startsWith('mock')) return 'mock';
  return 'openai';
}

export function buildRequest(
  req: Request,
  body: { model: string; messages: GatewayRequest['messages']; parameters: GatewayRequest['parameters'] },
): GatewayRequest {
  return {
    context: buildContext(req),
    provider: inferProvider(req, body.model),
    model: body.model,
    messages: body.messages,
    parameters: body.parameters,
  };
}
