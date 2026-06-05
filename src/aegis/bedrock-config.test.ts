import { describe, expect, test } from 'bun:test';
import {
  BEDROCK_CROSS_FAMILY_FALLBACK,
  BEDROCK_MODELS,
  bedrockFamily,
  pickBedrockCrossFamilyFallback,
} from './bedrock-config.js';

describe('bedrock-config', () => {
  test('bedrockFamily classifies anthropic correctly', () => {
    expect(bedrockFamily(BEDROCK_MODELS.ANTHROPIC_CLAUDE_SONNET)).toBe('anthropic');
    expect(bedrockFamily(BEDROCK_MODELS.ANTHROPIC_CLAUDE_HAIKU)).toBe('anthropic');
  });

  test('bedrockFamily classifies other vendors', () => {
    expect(bedrockFamily(BEDROCK_MODELS.META_LLAMA3_8B)).toBe('meta');
    expect(bedrockFamily(BEDROCK_MODELS.MISTRAL_7B)).toBe('mistral');
    expect(bedrockFamily(BEDROCK_MODELS.COHERE_COMMAND_R)).toBe('cohere');
    expect(bedrockFamily(BEDROCK_MODELS.AMAZON_NOVA_LITE)).toBe('amazon');
  });

  test('bedrockFamily returns unknown for non-bedrock model', () => {
    expect(bedrockFamily('openai/gpt-4.1')).toBe('unknown');
    expect(bedrockFamily('anthropic/claude-haiku-4-5')).toBe('unknown');
  });

  test('pickBedrockCrossFamilyFallback never returns same family', () => {
    const fallback = pickBedrockCrossFamilyFallback(
      BEDROCK_MODELS.ANTHROPIC_CLAUDE_SONNET,
      new Set(),
    );
    expect(fallback).not.toBeNull();
    expect(bedrockFamily(fallback as string)).not.toBe('anthropic');
  });

  test('pickBedrockCrossFamilyFallback respects alreadyTried', () => {
    const tried = new Set([BEDROCK_MODELS.META_LLAMA3_8B, BEDROCK_MODELS.MISTRAL_7B]);
    const fallback = pickBedrockCrossFamilyFallback(BEDROCK_MODELS.ANTHROPIC_CLAUDE_SONNET, tried);
    expect(fallback).toBe(BEDROCK_MODELS.AMAZON_NOVA_LITE);
  });

  test('pickBedrockCrossFamilyFallback returns null when all tried', () => {
    const all = new Set(BEDROCK_CROSS_FAMILY_FALLBACK.anthropic);
    const fallback = pickBedrockCrossFamilyFallback(BEDROCK_MODELS.ANTHROPIC_CLAUDE_SONNET, all);
    expect(fallback).toBeNull();
  });
});
