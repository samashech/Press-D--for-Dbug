import fs from 'fs';
import path from 'path';
import { getRoleProvider } from './providers/factory';
import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';
import chalk from 'chalk';

export interface GuardrailCheck {
  isSafe: boolean;
  reason?: string;
}

export async function isElementSafe(
  element: { text: string; selector?: string; formId?: string; formAction?: string },
  configPath: string = path.join(process.cwd(), 'autoqa.config.json')
): Promise<GuardrailCheck> {
  let config: any = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8')).audit || {};
  }

  const avoidText = (config.avoidText || []).map((t: string) => t.toLowerCase());
  const avoidSelectors = config.avoidSelectors || [];
  const neverSubmitForms = (config.neverSubmitForms || []).map((t: string) => t.toLowerCase());
  
  const textStr = (element.text || '').toLowerCase();
  
  // 1. Strict substring match
  for (const blockText of avoidText) {
    if (textStr.includes(blockText)) {
      return { isSafe: false, reason: `Matched avoidText: "${blockText}"` };
    }
  }

  // 2. Selector match
  if (element.selector) {
    for (const sel of avoidSelectors) {
      if (element.selector.includes(sel)) {
        return { isSafe: false, reason: `Matched avoidSelector: "${sel}"` };
      }
    }
  }

  // 3. Form match
  if (element.formId || element.formAction) {
    const formStr = `${element.formId || ''} ${element.formAction || ''}`.toLowerCase();
    for (const blockForm of neverSubmitForms) {
      if (formStr.includes(blockForm)) {
        return { isSafe: false, reason: `Matched neverSubmitForms: "${blockForm}"` };
      }
    }
  }

  // 4. LLM Judgment for ambiguous cases
  // If the text looks slightly risky but didn't match the hardcoded list (e.g. "Drop table", "Erase")
  const riskKeywords = ['drop', 'erase', 'clear', 'reset', 'pay', 'purchase', 'buy', 'checkout', 'submit payment'];
  if (riskKeywords.some(k => textStr.includes(k))) {
    console.log(chalk.yellow(`\n[Guardrail] Element "${element.text}" triggered risk heuristics. Running LLM safety check...`));
    
    try {
      const provider = getRoleProvider('featureClassifier'); // reuse the fast classifier model
      const schema = z.object({
        isDestructive: z.boolean(),
        reason: z.string()
      });

      const response = await provider.generate({
        messages: [
          { role: 'system', content: 'You are a safety guardrail for an automated UI testing bot. Determine if clicking or submitting this element is a "destructive" or "financial" action that should be avoided in an automated test (e.g., deleting data, making payments, logging out). Default to true (destructive) if you are unsure.' },
          { role: 'user', content: `Element Text: "${element.text}"\nSelector: "${element.selector || 'none'}"\nIs this destructive?` }
        ],
        responseSchema: zodToJsonSchema(schema, 'DestructiveCheck'),
        validate: (res) => {
          let text = res.text!.trim();
          if (text.startsWith('```json')) text = text.substring(7);
          if (text.startsWith('```')) text = text.substring(3);
          if (text.endsWith('```')) text = text.slice(0, -3);
          schema.parse(JSON.parse(text.trim()));
        }
      });

      let text = response.text!.trim();
      if (text.startsWith('```json')) text = text.substring(7);
      if (text.startsWith('```')) text = text.substring(3);
      if (text.endsWith('```')) text = text.slice(0, -3);
      
      const result = schema.parse(JSON.parse(text.trim()));
      
      if (result.isDestructive) {
        return { isSafe: false, reason: `LLM flagged as destructive: ${result.reason}` };
      }
    } catch (err: any) {
      console.warn(chalk.yellow(`[Guardrail] LLM check failed (${err.message}). Defaulting to unsafe.`));
      return { isSafe: false, reason: 'LLM check failed, skipped (skip-if-uncertain)' };
    }
  }

  return { isSafe: true };
}
