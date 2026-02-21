// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import { llmClient, embedDocument } from '../storage/embeddings';
import { redactPII } from './safety';
import { dedupAndStore } from './dedup';
import { checkpointLog } from '../storage/checkpoints';

export interface ExtractedFact {
  content: string;
  category: string;
  confidence: number;
}

const SYSTEM_PROMPT = `Extract facts about the user from this conversation turn.

Rules:
- Only extract clear statements the user made, not what the assistant said
- Skip speculation ("might like", "maybe I'll try"), questions, and filler
- Preserve conditions: "hates avocados on a mountain" ≠ "hates avocados"
- Each fact must be a complete, standalone statement about the user
- If nothing worth extracting, return an empty facts array

Each item: {"content": "short fact", "category": "preference|project_context|technical_choice|personal_info|decision|constraint|todo", "confidence": 0.0-1.0}

Respond with: {"facts": [...]}`;

// A message that is purely a question should not be extracted as fact.
// "I hate avocados?" is asking, not telling. But "I hate avocados. Don't you?"
// contains a statement followed by a question — that's fine to extract from.
function isPureQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.endsWith('?')) return false;
  // If it contains a period or exclamation before the question mark,
  // there's a declarative sentence in there too — allow extraction.
  const beforeQuestion = trimmed.slice(0, -1);
  return !beforeQuestion.includes('.') && !beforeQuestion.includes('!');
}

export async function extractFacts(
  userInput: string,
  assistantOutput: string,
): Promise<ExtractedFact[]> {
  if (isPureQuestion(userInput)) {
    console.log(`[extract] skipping question input: "${userInput.slice(0, 80)}"`);
    return [];
  }

  let userPrompt = `User said: ${userInput}\nAssistant said: ${assistantOutput}`;

  if (userPrompt.length > 8000) {
    userPrompt = userPrompt.slice(0, 8000) + '\n[truncated]';
  }

  try {
    const result = await llmClient.chatJSON<{ facts: unknown }>([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.1, maxTokens: 1024 });

    const facts = result.facts;
    if (!Array.isArray(facts)) {
      console.log('[extract] model returned non-array facts, discarding');
      return [];
    }

    return (facts as ExtractedFact[]).map(f => ({
      ...f,
      // Qwen2.5-3B sometimes omits confidence — default to 0.8
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.8,
    })).filter(f => {
      if (typeof f.content !== 'string' || typeof f.category !== 'string') return false;
      // Must be a real fact: at least 2 words, at least 10 chars
      const words = f.content.trim().split(/\s+/);
      if (words.length < 2 || f.content.trim().length < 10) {
        console.log(`[extract] discarding too-short fact: "${f.content}"`);
        return false;
      }
      // Discard low-confidence extractions
      if (f.confidence < 0.5) {
        console.log(`[extract] discarding low-confidence fact (${f.confidence}): "${f.content}"`);
        return false;
      }
      // Discard speculative facts (model guessing instead of extracting)
      if (/\b(might|may|could|possibly|perhaps|considering|thinking about|wondering if)\b/i.test(f.content)) {
        console.log(`[extract] discarding speculative fact: "${f.content}"`);
        return false;
      }
      // Discard facts about the assistant, not the user
      if (/\b(assistance offered|help with|is a .*(tool|assistant|bot)|suggested|recommended)\b/i.test(f.content)) {
        console.log(`[extract] discarding assistant-about fact: "${f.content}"`);
        return false;
      }
      return true;
    });
  } catch (err) {
    console.error('[extract] extraction failed:', err);
    return [];
  }
}

export async function extractAndStore(
  userInput: string,
  assistantOutput: string,
  sessionId: string,
  checkpointId: string,
): Promise<void> {
  // Skip extraction for very short user input — not enough signal
  if (userInput.trim().split(/\s+/).length < 3) {
    console.log(`[extract] skipping too-short input: "${userInput.slice(0, 50)}"`);
    await checkpointLog.markExtracted(checkpointId);
    return;
  }

  try {
    const facts = await extractFacts(userInput, assistantOutput);

    if (facts.length === 0) {
      console.log(`[extract] no facts from checkpoint ${checkpointId}`);
      await checkpointLog.markExtracted(checkpointId);
      return;
    }

    console.log(`[extract] ${facts.length} facts from checkpoint ${checkpointId}`);

    for (const fact of facts) {
      const cleanContent = redactPII(fact.content);
      const embedding = await embedDocument(cleanContent);
      await dedupAndStore(cleanContent, fact.category, fact.confidence, embedding);
    }

    await checkpointLog.markExtracted(checkpointId);
    console.log(`[extract] checkpoint ${checkpointId} done`);
  } catch (err) {
    console.error(`[extract] pipeline error for checkpoint ${checkpointId}:`, err);
  }
}
