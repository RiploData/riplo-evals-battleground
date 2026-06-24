// src/services/generation/provider.ts
// Neutral provider interface — no SDK imports here.

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
