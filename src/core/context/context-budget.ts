import { estimateTokens } from '../../shared/tokens.js';

export interface ContextBudget {
  totalTokens: number;
  usedTokens: number;
  remainingTokens: number;
  truncated: boolean;
}

export function createBudget(maxTokens: number): ContextBudget {
  return { totalTokens: maxTokens, usedTokens: 0, remainingTokens: maxTokens, truncated: false };
}

export function consumeBudget(
  budget: ContextBudget,
  text: string,
): { text: string; budget: ContextBudget } {
  const tokens = estimateTokens(text);
  if (tokens <= budget.remainingTokens) {
    return {
      text,
      budget: {
        ...budget,
        usedTokens: budget.usedTokens + tokens,
        remainingTokens: budget.remainingTokens - tokens,
      },
    };
  }
  const maxChars = budget.remainingTokens * 4;
  const truncated = text.slice(0, maxChars) + '\n... [truncated]';
  return {
    text: truncated,
    budget: {
      ...budget,
      usedTokens: budget.usedTokens + budget.remainingTokens,
      remainingTokens: 0,
      truncated: true,
    },
  };
}
