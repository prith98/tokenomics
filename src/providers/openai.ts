import OpenAI from 'openai';
import type { GatewayRequest, ProviderResponse, StreamChunk } from '../types.js';
import { ProviderError, type ProviderClient } from './index.js';

export class OpenAIProvider implements ProviderClient {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(request: GatewayRequest): Promise<ProviderResponse> {
    try {
      const completion = await this.client.chat.completions.create({
        model: request.model,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.name ? { name: m.name } : {}),
        })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        max_tokens: request.parameters.max_tokens,
        temperature: request.parameters.temperature,
        top_p: request.parameters.top_p,
        stop: request.parameters.stop,
      });

      const choice = completion.choices[0];
      const text = choice?.message?.content ?? '';
      const usage = completion.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      return {
        text,
        model: completion.model,
        finish_reason: choice?.finish_reason ?? 'stop',
        usage: {
          input_tokens: usage.prompt_tokens,
          output_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
        },
        raw: completion,
      };
    } catch (err) {
      if (err instanceof OpenAI.APIError) {
        throw new ProviderError(err.message, err.status ?? 500, this.name);
      }
      throw new ProviderError((err as Error).message, 500, this.name);
    }
  }

  async *stream(request: GatewayRequest): AsyncIterable<StreamChunk> {
    try {
      const messages = request.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
      })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];
      const stream = await this.client.chat.completions.create({
        model: request.model,
        messages,
        max_tokens: request.parameters.max_tokens,
        temperature: request.parameters.temperature,
        top_p: request.parameters.top_p,
        stop: request.parameters.stop,
        stream: true,
      });
      let lastFinishReason: string | undefined;
      for await (const part of stream) {
        const choice = part.choices?.[0];
        const text = choice?.delta?.content ?? '';
        if (choice?.finish_reason) lastFinishReason = choice.finish_reason;
        if (text) yield { text, is_final: false };
      }
      yield { text: '', finish_reason: lastFinishReason ?? 'stop', is_final: true };
    } catch (err) {
      if (err instanceof OpenAI.APIError) {
        throw new ProviderError(err.message, err.status ?? 500, this.name);
      }
      throw new ProviderError((err as Error).message, 500, this.name);
    }
  }
}
