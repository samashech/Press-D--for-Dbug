import fs from 'fs';
import path from 'path';
import os from 'os';

export let globalConfig: any = null;

export function loadConfig() {
  const configPath = path.join(process.cwd(), 'autoqa.config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.databaseUrl) {
        process.env.DATABASE_URL = config.databaseUrl;
      }
      if (config.geminiApiKey) {
        process.env.GEMINI_API_KEY = config.geminiApiKey;
      }
      globalConfig = config;
      return config;
    } catch (e) {
      console.error('Failed to parse autoqa.config.json');
    }
  } else {
    // Default fallback to global autoqa db
    const homeDb = path.join(os.homedir(), '.autoqa', 'dev.db');
    process.env.DATABASE_URL = `file:${homeDb}`;
  }
  return null;
}

loadConfig();
