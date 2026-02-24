/**
 * Mythic AI SDK — Client library for interacting with the decentralized AI network.
 * Used by: Telegram bot, browser extension wallet, dApps, CLI.
 *
 * Usage:
 *   const ai = new MythicAI({ gatewayUrl: "https://ai.mythic.sh" });
 *   const result = await ai.chat("What is Mythic L2?");
 *   console.log(result.output);
 */

export interface MythicAIConfig {
  gatewayUrl: string;
  walletPublicKey?: string;
}

export interface InferenceResult {
  jobId: string;
  status: string;
  output: string;
  outputHash: string;
  tokensGenerated: number;
  computeUnits: string;
  latencyMs: number;
  validator: string;
  onChain: boolean;
}

export interface CostEstimate {
  estimatedCostLamports: string;
  estimatedCostSol: string;
  promptTokens: number;
  maxCompletionTokens: number;
}

export interface NetworkStats {
  activeValidators: number;
  totalGpuVramGb: number;
  totalInferenceCapacity: number;
  totalInferencesCompleted: number;
  modelsAvailable: string[];
}

export class MythicAI {
  private gatewayUrl: string;
  private walletPublicKey?: string;

  constructor(config: MythicAIConfig) {
    this.gatewayUrl = config.gatewayUrl.replace(/\/$/, "");
    this.walletPublicKey = config.walletPublicKey;
  }

  /**
   * Simple chat — send a prompt, get a response.
   */
  async chat(prompt: string, maxTokens = 512): Promise<InferenceResult> {
    const resp = await fetch(`${this.gatewayUrl}/v1/inference`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        max_tokens: maxTokens,
        wallet: this.walletPublicKey,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(`AI inference failed: ${(err as any).error}`);
    }

    const data: any = await resp.json();
    return {
      jobId: data.job_id,
      status: data.status,
      output: data.output,
      outputHash: data.output_hash,
      tokensGenerated: data.tokens_generated,
      computeUnits: data.compute_units,
      latencyMs: data.latency_ms,
      validator: data.validator,
      onChain: data.on_chain,
    };
  }

  /**
   * OpenAI-compatible chat completions.
   */
  async chatCompletions(
    messages: { role: string; content: string }[],
    model?: string,
    maxTokens = 512
  ): Promise<any> {
    const resp = await fetch(`${this.gatewayUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, model, max_tokens: maxTokens }),
    });

    if (!resp.ok) throw new Error("Chat completion failed");
    return resp.json();
  }

  /**
   * Get cost estimate before submitting.
   */
  async estimate(prompt: string, maxTokens = 512): Promise<CostEstimate> {
    const resp = await fetch(`${this.gatewayUrl}/v1/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, max_tokens: maxTokens }),
    });

    const data: any = await resp.json();
    return {
      estimatedCostLamports: data.estimated_cost_lamports,
      estimatedCostSol: data.estimated_cost_sol,
      promptTokens: data.prompt_tokens,
      maxCompletionTokens: data.max_completion_tokens,
    };
  }

  /**
   * Get network statistics.
   */
  async network(): Promise<NetworkStats> {
    const resp = await fetch(`${this.gatewayUrl}/v1/network`);
    const data: any = await resp.json();
    return {
      activeValidators: data.active_validators,
      totalGpuVramGb: data.total_gpu_vram_gb,
      totalInferenceCapacity: data.total_inference_capacity,
      totalInferencesCompleted: data.total_inferences_completed,
      modelsAvailable: data.models_available,
    };
  }

  /**
   * List available models.
   */
  async models(): Promise<any[]> {
    const resp = await fetch(`${this.gatewayUrl}/v1/models`);
    const data: any = await resp.json();
    return data.data;
  }

  /**
   * Check job status.
   */
  async jobStatus(jobId: string): Promise<any> {
    const resp = await fetch(`${this.gatewayUrl}/v1/jobs/${jobId}`);
    return resp.json();
  }
}
