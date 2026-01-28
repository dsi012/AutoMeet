/**
 * Application Configuration
 * 
 * ⚠️ IMPORTANT:
 * This file contains placeholder values. You need to configure your API keys either:
 * 
 * Option 1 (Recommended): Use the Settings panel in the app
 * - Click the ⚙️ Settings button in the app
 * - Enter your API keys directly in the UI
 * - Keys are stored securely in your local app data
 * 
 * Option 2: Encode keys here (for developers)
 * - Encode your keys using: Buffer.from('your-api-key').toString('base64').split('').reverse().join('')
 * - Replace the empty strings below with your encoded keys
 * - This provides basic obfuscation (NOT real security)
 * 
 * Required API Keys:
 * - ElevenLabs API Key: For text-to-speech
 * - OpenAI API Key: For meeting detection
 * - Google Calendar credentials
 * 
 * Security Best Practices:
 * 1. Never commit real API keys to version control
 * 2. Set budget limits on your API provider dashboards
 * 3. Monitor API usage regularly
 * 4. Use environment variables for production deployments
 */

// Simple encoding function (Base64 + reverse)
function decode(encoded: string): string {
  if (!encoded) return '';
  try {
    return Buffer.from(encoded.split('').reverse().join(''), 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

// Encoded API keys (replace these with your encoded keys)
// To encode your key: Buffer.from('your-api-key').toString('base64').split('').reverse().join('')
const ENCODED_KEYS = {
  // Replace with your encoded ElevenLabs API key
  ELEVENLABS: '',
  
  // Replace with your encoded OpenAI API key
  OPENAI: '',
  
  // Replace with your encoded Anthropic API key (optional - for Claude models)
  ANTHROPIC: '',
  
  // Replace with your encoded Google Client ID (optional)
  GOOGLE_ID: '',
  
  // Replace with your encoded Google Client Secret (optional)
  GOOGLE_SECRET: '',
};

export interface AppConfig {
  elevenlabsApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  googleClientId: string;
  googleClientSecret: string;
}

// Supported LLM providers
export type LLMProvider = 'openai' | 'anthropic';

// Model configuration
export const LLM_CONFIG = {
  // Current provider to use
  provider: 'anthropic' as LLMProvider,
  
  // Model names for each provider
  models: {
    openai: 'gpt-5.2',
    anthropic: 'claude-sonnet-4-5',
  },
};

/**
 * Get the application configuration
 * Returns built-in API keys, so users don't need to configure anything
 */
export function getConfig(): AppConfig {
  return {
    elevenlabsApiKey: decode(ENCODED_KEYS.ELEVENLABS),
    openaiApiKey: decode(ENCODED_KEYS.OPENAI),
    anthropicApiKey: decode(ENCODED_KEYS.ANTHROPIC),
    googleClientId: decode(ENCODED_KEYS.GOOGLE_ID),
    googleClientSecret: decode(ENCODED_KEYS.GOOGLE_SECRET),
  };
}

/**
 * Check if all required API keys are configured
 */
export function isConfigured(): boolean {
  const config = getConfig();
  return !!(
    config.elevenlabsApiKey &&
    config.openaiApiKey
  );
}

/**
 * Get missing API keys
 */
export function getMissingKeys(): string[] {
  const config = getConfig();
  const missing: string[] = [];

  if (!config.elevenlabsApiKey) missing.push('ElevenLabs API Key');
  if (!config.openaiApiKey) missing.push('OpenAI API Key');

  return missing;
}

