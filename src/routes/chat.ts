import { Router } from 'express';
import { z } from 'zod';
import { buildRequest } from '../pipeline/enrich.js';
import { runPipeline } from '../pipeline/dispatch.js';
import { PolicyRejectionError } from '../pipeline/policy.js';
import { BUDGET_KILL_SENTINEL } from '../pipeline/stream.js';
import { ProviderError } from '../providers/index.js';
import { log } from '../log.js';

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  name: z.string().optional(),
});

const bodySchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  stream: z.boolean().optional(),
});

export const chatRouter: Router = Router();

chatRouter.post('/v1/chat/completions', async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'invalid_request', issues: parsed.error.issues } });
    return;
  }
  const body = parsed.data;

  const gatewayRequest = buildRequest(req, {
    model: body.model,
    messages: body.messages,
    parameters: {
      max_tokens: body.max_tokens,
      temperature: body.temperature,
      top_p: body.top_p,
      stop: body.stop,
      stream: body.stream,
    },
  });

  try {
    const result = await runPipeline(gatewayRequest);

    if (result.type === 'cache') {
      const { costEvent, cacheHit, text } = result;
      res.setHeader('X-Gateway-Request-Id', costEvent.request_id);
      res.setHeader('X-Gateway-Cost-Usd', costEvent.total_cost_usd.toFixed(6));
      res.setHeader('X-Gateway-Tokens-Used', String(costEvent.total_tokens));
      res.setHeader('X-Gateway-Policy-Action', costEvent.policy_action);
      res.setHeader('X-Gateway-Provider', costEvent.provider);
      res.setHeader('X-Gateway-Cache-Hit', cacheHit.hit_type);
      res.setHeader('X-Gateway-Cache-Savings-Usd', cacheHit.savings_usd.toFixed(6));

      if (body.stream) {
        writeSseHeaders(res);
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: text }, finish_reason: null }],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'stop' }],
          })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.json({
        id: `gw-${costEvent.request_id}`,
        object: 'chat.completion',
        created: Math.floor(Date.parse(costEvent.timestamp) / 1000),
        model: costEvent.model,
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: text },
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
      return;
    }

    if (result.type === 'stream') {
      res.setHeader('X-Gateway-Request-Id', result.requestId);
      res.setHeader('X-Gateway-Policy-Action', result.policyAction);
      res.setHeader('X-Gateway-Provider', result.provider);
      writeSseHeaders(res);

      try {
        for await (const chunk of result.stream) {
          if (chunk === BUDGET_KILL_SENTINEL) {
            res.write(
              `data: ${JSON.stringify({
                choices: [{ delta: {}, finish_reason: 'budget_kill' }],
              })}\n\n`,
            );
            break;
          }
          res.write(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: chunk }, finish_reason: null }],
            })}\n\n`,
          );
        }
        res.write('data: [DONE]\n\n');
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'stream error during response');
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'error' }],
          })}\n\n`,
        );
      } finally {
        res.end();
      }
      return;
    }

    const { response, costEvent } = result;
    res.setHeader('X-Gateway-Request-Id', costEvent.request_id);
    res.setHeader('X-Gateway-Cost-Usd', costEvent.total_cost_usd.toFixed(6));
    res.setHeader('X-Gateway-Tokens-Used', String(costEvent.total_tokens));
    res.setHeader('X-Gateway-Policy-Action', costEvent.policy_action);
    res.setHeader('X-Gateway-Provider', costEvent.provider);

    res.json({
      id: `gw-${costEvent.request_id}`,
      object: 'chat.completion',
      created: Math.floor(Date.parse(costEvent.timestamp) / 1000),
      model: response.model,
      choices: [
        {
          index: 0,
          finish_reason: response.finish_reason,
          message: { role: 'assistant', content: response.text },
        },
      ],
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.total_tokens,
      },
    });
  } catch (err) {
    if (err instanceof PolicyRejectionError) {
      const { decision, retryAfterSeconds } = err;
      const errorType = decision.action === 'THROTTLE' ? 'rate_limited' : 'budget_exceeded';
      res.setHeader('X-Gateway-Policy-Action', decision.action);
      if (retryAfterSeconds !== undefined) {
        res.setHeader('Retry-After', String(retryAfterSeconds));
      }
      res.status(429).json({
        error: {
          type: errorType,
          message: err.message,
          rules_evaluated: decision.rules_evaluated,
        },
      });
      return;
    }
    if (err instanceof ProviderError) {
      log.warn({ err, provider: err.provider }, 'provider call failed');
      res.status(502).json({
        error: { type: 'provider_error', provider: err.provider, message: err.message },
      });
      return;
    }
    log.error({ err }, 'unexpected pipeline error');
    res.status(500).json({ error: { type: 'internal_error', message: (err as Error).message } });
  }
});

function writeSseHeaders(res: import('express').Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}
