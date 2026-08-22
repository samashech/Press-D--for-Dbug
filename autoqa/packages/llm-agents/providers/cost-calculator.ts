export function calculateCost(provider: string, model: string, promptTokens: number, completionTokens: number): number {
  if (provider === 'local') return 0.0;

  // Pricing per 1M tokens in USD
  const rates: Record<string, { prompt: number; completion: number }> = {
    'gemini-2.5-flash': { prompt: 0.075, completion: 0.30 },
    'gemini-1.5-pro': { prompt: 3.50, completion: 10.50 },
    'claude-3-5-sonnet-20241022': { prompt: 3.00, completion: 15.00 },
    'claude-3-haiku-20240307': { prompt: 0.25, completion: 1.25 },
    'gpt-4o': { prompt: 5.00, completion: 15.00 },
    'gpt-4o-mini': { prompt: 0.15, completion: 0.60 },
  };

  const rate = rates[model];
  if (!rate) {
    // Unknown model fallback, use 0 or some default
    return 0.0;
  }

  const promptCost = (promptTokens / 1_000_000) * rate.prompt;
  const completionCost = (completionTokens / 1_000_000) * rate.completion;
  
  return promptCost + completionCost;
}
