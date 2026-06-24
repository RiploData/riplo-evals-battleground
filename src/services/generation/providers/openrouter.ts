import OpenAI from 'openai';

export interface ProviderRequest {
  model: string;
  system: string;
  user: string;
  params: Record<string, unknown>;
}

export interface ProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
  providerRequestId?: string;
  modelReportedVersion?: string;
  raw: unknown;
}

export interface GenerationProvider {
  execute(req: ProviderRequest): Promise<ProviderResult>;
}

function makeClient(): OpenAI {
  return new OpenAI({
    baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
  });
}

export const openRouterProvider: GenerationProvider = {
  async execute(req: ProviderRequest): Promise<ProviderResult> {
    const client = makeClient();

    const { model, system, user, params } = req;

    const completion = (await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...params,
      stream: false,
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)) as OpenAI.Chat.Completions.ChatCompletion;

    const choice = completion.choices[0];
    const text = choice?.message?.content ?? '';
    const finishReason = choice?.finish_reason ?? 'unknown';
    const inputTokens = completion.usage?.prompt_tokens ?? 0;
    const outputTokens = completion.usage?.completion_tokens ?? 0;

    return {
      text,
      inputTokens,
      outputTokens,
      finishReason,
      providerRequestId: completion.id,
      modelReportedVersion: undefined,
      raw: completion,
    };
  },
};
