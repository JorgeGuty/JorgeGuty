import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-4-8';

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Calls Claude with a JSON schema-constrained output and returns the parsed
 * first text block. Vision content is passed through as-is.
 */
export async function structuredCall<T>(opts: {
  system: string;
  content: Anthropic.MessageParam['content'];
  schema: Record<string, unknown>;
  maxTokens?: number;
  thinking?: boolean;
}): Promise<T> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    ...(opts.thinking ? { thinking: { type: 'adaptive' as const } } : {}),
    system: opts.system,
    output_config: {
      format: { type: 'json_schema', schema: opts.schema },
    },
    messages: [{ role: 'user', content: opts.content }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('El modelo rechazó la solicitud.');
  }
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') {
    throw new Error('Respuesta sin contenido de texto.');
  }
  return JSON.parse(text.text) as T;
}
