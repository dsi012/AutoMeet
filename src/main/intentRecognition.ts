import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { LLM_CONFIG, LLMProvider } from './config';

// Availability time slot type
export interface TimeSlot {
  startTime: string;  // ISO format
  endTime: string;    // ISO format
  isFree: boolean;
}

// Availability check result
export interface AvailabilityResult {
  date: string;
  participants: string[];
  duration: number;
  startHour?: number;
  endHour?: number;
  availableSlots: TimeSlot[];
  firstAvailableTime?: string;  // ISO format - first available time within specified time range
}

// Availability checker function type
export type AvailabilityChecker = (
  date: string,
  participants: string[],
  duration: number,
  startHour?: number,
  endHour?: number
) => Promise<AvailabilityResult>;

// Tool parameter definition (common format)
const toolParameters = {
  type: 'object' as const,
  properties: {
    date: {
      type: 'string',
      description: 'The date to check availability (YYYY-MM-DD format)',
    },
    participants: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of participant names to check availability for',
    },
    duration: {
      type: 'number',
      description: 'Meeting duration in minutes (default: 30)',
    },
    start_hour: {
      type: 'number',
      description: 'Start hour of the time range to search (0-23, in local timezone). E.g., 9 for 9 AM, 15 for 3 PM. Default: 9',
    },
    end_hour: {
      type: 'number',
      description: 'End hour of the time range to search (0-23, in local timezone). E.g., 17 for 5 PM, 20 for 8 PM. Default: 18',
    },
  },
  required: ['date', 'participants', 'duration'],
};

// Define tools callable by OpenAI
const openaiTools: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Check free/busy time slots for specified participants on a given date within a specific time range. Returns available slots and the first available time.',
      parameters: toolParameters,
    },
  },
];

// Define tools callable by Anthropic
const anthropicTools: Anthropic.Tool[] = [
  {
    name: 'check_availability',
    description: 'Check free/busy time slots for specified participants on a given date within a specific time range. Returns available slots and the first available time.',
    input_schema: toolParameters,
  },
];

export class IntentRecognitionService {
  private openai: OpenAI | null = null;
  private anthropic: Anthropic | null = null;
  private provider: LLMProvider;
  private transcriptBuffer: string[] = [];
  private contactsMap: Map<string, { name: string; email?: string; mobile?: string; timezone?: string }> | null = null;
  private availabilityChecker: AvailabilityChecker | null = null;
  private lastTranscriptTime: number = 0;  // Time of last received transcript
  private lastAnalysisTime: number = 0;     // Time of last analysis
  private lastAnalyzedBufferLength: number = 0;  // Buffer length at last analysis
  private idleCheckInterval: NodeJS.Timeout | null = null;  // Timer checker
  private onIdleAnalysis?: () => Promise<void>;  // Analysis callback triggered when idle
  private isAnalyzing: boolean = false;  // Whether currently analyzing (prevent duplicate triggers)

  constructor(openaiApiKey: string, anthropicApiKey?: string) {
    this.provider = LLM_CONFIG.provider;
    
    // Initialize OpenAI client (always needed as it's the default provider)
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    
    // If Anthropic API key is provided, also initialize it
    if (anthropicApiKey) {
      this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
      console.log('✅ Anthropic client initialized');
    }
    
    console.log(`🤖 Using LLM provider: ${this.provider} (model: ${LLM_CONFIG.models[this.provider]})`);
  }

  /**
   * Switch to a different LLM provider
   */
  setProvider(provider: LLMProvider) {
    if (provider === 'anthropic' && !this.anthropic) {
      console.warn('⚠️ Anthropic client not initialized, staying with OpenAI');
      return;
    }
    this.provider = provider;
    console.log(`🔄 Switched to LLM provider: ${provider} (model: ${LLM_CONFIG.models[provider]})`);
  }

  /**
   * Get current provider
   */
  getProvider(): LLMProvider {
    return this.provider;
  }

  setContactsMap(contacts: Map<string, { name: string; email?: string; mobile?: string; timezone?: string }>) {
    this.contactsMap = contacts;
  }

  /**
   * Set the availability checker callback function.
   * This will be called by GPT to check calendar availability.
   */
  setAvailabilityChecker(checker: AvailabilityChecker) {
    this.availabilityChecker = checker;
    console.log('✅ Availability checker set for intent recognition');
  }

  /**
   * Set callback for idle analysis (triggered when no new transcript for 20 seconds)
   */
  setIdleAnalysisCallback(callback: () => Promise<void>) {
    this.onIdleAnalysis = callback;
  }

  /**
   * Start monitoring for idle periods (20 seconds without new transcript)
   */
  startIdleMonitoring() {
    // Check every 5 seconds if trigger conditions are met
    this.idleCheckInterval = setInterval(() => {
      // Skip if we've never received any transcript
      if (this.lastTranscriptTime === 0) {
        return;
      }
      
      const now = Date.now();
      const timeSinceLastTranscript = now - this.lastTranscriptTime;
      // Use actual buffer length to check for new content (not timestamp)
      // This avoids false positives from partial transcripts that don't add to buffer
      const hasNewContent = this.transcriptBuffer.length > this.lastAnalyzedBufferLength;
      
      // Condition: 20 seconds without new transcript && new content since last analysis (buffer grew) && not analyzing
      if (timeSinceLastTranscript >= 20000 && hasNewContent && this.transcriptBuffer.length > 0 && !this.isAnalyzing) {
        console.log('⏰ Idle timeout: 20 seconds since last transcript, triggering analysis...');
        console.log(`   Buffer: ${this.transcriptBuffer.length} items (last analyzed: ${this.lastAnalyzedBufferLength})`);
        this.isAnalyzing = true;  // Set flag to prevent duplicate triggers
        
        if (this.onIdleAnalysis) {
          this.onIdleAnalysis()
            .catch(error => {
              console.error('Error in idle analysis:', error);
            })
            .finally(() => {
              this.isAnalyzing = false;  // Reset flag after analysis completes
              console.log('✅ Idle analysis completed, transcription should continue...');
            });
        } else {
          this.isAnalyzing = false;
        }
      } else if (this.lastTranscriptTime > 0) {
        // Output status log every 30 seconds to help debugging
        const shouldLog = Math.floor(now / 30000) !== Math.floor((now - 5000) / 30000);
        if (shouldLog) {
          console.log(`📊 Idle check status: timeSinceLastTranscript=${Math.round(timeSinceLastTranscript/1000)}s, hasNewContent=${hasNewContent}, bufferLength=${this.transcriptBuffer.length}, isAnalyzing=${this.isAnalyzing}`);
        }
      }
    }, 5000);  // Check every 5 seconds
    
    console.log('✅ Idle monitoring started (20 second threshold)');
  }

  /**
   * Stop idle monitoring
   */
  stopIdleMonitoring() {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
      console.log('🛑 Idle monitoring stopped');
    }
  }

  addTranscript(text: string) {
    this.transcriptBuffer.push(text);
    this.lastTranscriptTime = Date.now();  // Update time of last received transcript
  }

  /**
   * Update the last transcript time without adding to buffer
   * Used for partial transcripts to track activity
   */
  updateLastTranscriptTime() {
    this.lastTranscriptTime = Date.now();
  }

  clearBuffer() {
    this.transcriptBuffer = [];
    this.lastAnalyzedBufferLength = 0;  // Reset so new content will be detected
  }
  
  /**
   * Mark that analysis was performed (used by external callers like stopTranscription)
   */
  markAnalysisPerformed() {
    this.lastAnalysisTime = Date.now();
    this.lastAnalyzedBufferLength = this.transcriptBuffer.length;
  }

  /**
   * Check if there's new content since last analysis
   * Uses actual buffer length instead of timestamp to avoid false positives from partial transcripts
   */
  hasNewContentSinceLastAnalysis(): boolean {
    // Check if buffer has grown since last analysis
    return this.transcriptBuffer.length > this.lastAnalyzedBufferLength;
  }

  getFullTranscript(): string {
    return this.transcriptBuffer.join('\n');
  }

  /**
   * Extract all meetings from the complete transcript when recording stops.
   * Uses Function Calling to check calendar availability before suggesting times.
   */
  async extractAllMeetingsFromTranscript(
    fullTranscript: string,
    createdMeetings: any[]
  ): Promise<any[]> {
    try {
      console.log('🔍 Analyzing full transcript for meetings...');
      console.log('📝 Transcript length:', fullTranscript.length, 'chars');
      if (fullTranscript.length < 10) {
        console.log('⚠️ Transcript too short, skipping analysis');
        return [];
      }
      console.log('📝 Transcript preview:', fullTranscript.substring(0, 200) + (fullTranscript.length > 200 ? '...' : ''));
      
      // Build context about already created meetings
      let createdMeetingsContext = '';
      if (createdMeetings && createdMeetings.length > 0) {
        const meetingsList = createdMeetings
          .map((m, i) => {
            const dateStr = m.startTime ? new Date(m.startTime).toLocaleString() : 'unknown';
            const deletedTag = (m as any).deleted ? ' [DELETED BY USER - DO NOT RECREATE]' : '';
            return `${i + 1}. Title: "${m.title || 'Untitled'}"${deletedTag} | Participants: ${m.participants?.join(', ') || 'none'} | Time: ${dateStr}`;
          })
          .join('\n');
        
        createdMeetingsContext = `
ALREADY CREATED MEETINGS (do NOT include these):
${meetingsList}

IMPORTANT: Meetings marked as [DELETED BY USER] were intentionally deleted and should NEVER be recreated, even if mentioned in the transcript.
`;
      }

      // Build contacts list with timezone information
      let contactsList = '';
      if (this.contactsMap) {
        const contacts: string[] = [];
        for (const [_, contact] of this.contactsMap.entries()) {
          const tzInfo = contact.timezone ? ` (${contact.timezone})` : '';
          contacts.push(`${contact.name}${tzInfo}`);
        }
        contactsList = `
AVAILABLE CONTACTS (use these exact names for participants, timezone info provided for scheduling):
${contacts.join(', ')}
`;
      }

      const currentTime = new Date().toLocaleString('en-US', { 
        timeZone: 'America/Los_Angeles', 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric', 
        weekday: 'short', 
        hour: 'numeric', 
        hour12: true 
      });

      // Use different prompts based on whether availability checker exists
      const hasAvailabilityChecker = !!this.availabilityChecker;
      
      const systemPrompt = hasAvailabilityChecker 
        ? `You are an AI assistant that extracts meeting scheduling requests from a meeting transcript.

Your task:
1. Analyze the full transcript and identify ALL meetings that were requested to be scheduled
2. For each meeting, extract: title, participants (use the exact names from the AVAILABLE CONTACTS list), and duration
3. Do NOT include meetings that were already created (see list below)
4. Only include meetings with clear scheduling intent (e.g., "schedule a meeting", "set up a call", "let's meet")

IMPORTANT: Before finalizing each meeting, you MUST call the check_availability tool to find the best available time slot based on participants' calendars.

CRITICAL RULE - RESPECTING USER'S TIME PREFERENCE:
- If the user specifies an EXACT time (e.g., "1 PM", "3:00 PM"), you MUST use that exact time
- Do NOT change the user's specified time even if it causes timezone conflicts
- Only suggest alternative times when the user does NOT specify an exact time (e.g., "morning", "afternoon", "next week")
- If user says "1 PM" and it's nighttime for some participants, still schedule at 1 PM and let the user decide

TIMEZONE-AWARE SCHEDULING (only when user does NOT specify exact time):
- Participants may be in different timezones (shown in AVAILABLE CONTACTS list)
- The check_availability tool returns 24-hour time slots to support all timezones
- When selecting meeting times, consider ALL participants' timezones and working hours
- Prefer times that fall within normal working hours (9 AM - 6 PM) for ALL participants
- If possible, avoid scheduling during nighttime (10 PM - 6 AM) in any participant's timezone
- If perfect overlap isn't possible, prioritize times that are reasonable for the majority

When calling check_availability, use start_hour and end_hour to specify the time range:
- EXACT time specified (e.g., "1 PM", "3:00 PM") → Use that exact hour (e.g., start_hour: 13, end_hour: 14)
- "morning" → start_hour: 9, end_hour: 12
- "afternoon" → start_hour: 13, end_hour: 18
- "after 2 PM" → start_hour: 14, end_hour: 23
- "evening" → start_hour: 17, end_hour: 23
- No time specified → start_hour: 0, end_hour: 23 (search all day, then filter by timezone)

Current time (Pacific): ${currentTime}

${createdMeetingsContext}
${contactsList}

After checking availability for each meeting, respond with a JSON object:
{
  "meetings": [
    {
      "title": "meeting title/topic",
      "participants": ["name1", "name2"],
      "suggestedDate": "ISO format datetime (choose from available slots considering all participants' timezones)",
      "duration": 30,
      "context": "brief description of meeting purpose and why this time works for all timezones"
    }
  ],
  "analysis": "brief explanation of what meetings were found and how times were selected considering participants' timezones"
}

If no new meetings need to be created, return an empty meetings array.`
        : `You are an AI assistant that extracts ALL meeting scheduling requests from a meeting transcript.

Your task:
1. Analyze the full transcript and identify ALL meetings that were requested to be scheduled
2. For each meeting, extract: title, participants (use the exact names from the AVAILABLE CONTACTS list), time, and duration
3. Do NOT include meetings that were already created (see list below)
4. Only include meetings with clear scheduling intent (e.g., "schedule a meeting", "set up a call", "let's meet")

Current time (Pacific): ${currentTime}

${createdMeetingsContext}
${contactsList}

Respond with a JSON object:
{
  "meetings": [
    {
      "title": "meeting title/topic",
      "participants": ["name1", "name2"],
      "suggestedDate": "ISO format datetime",
      "duration": 30,
      "context": "brief description of meeting purpose"
    }
  ],
  "analysis": "brief explanation of what meetings were found and which were skipped (if any were already created)"
}

If no new meetings need to be created, return an empty meetings array.`;

      // Call different implementations based on provider
      if (this.provider === 'anthropic' && this.anthropic) {
        return await this.extractWithAnthropic(systemPrompt, fullTranscript, hasAvailabilityChecker);
      } else {
        return await this.extractWithOpenAI(systemPrompt, fullTranscript, hasAvailabilityChecker);
      }
    } catch (error) {
      console.error('Error extracting meetings from transcript:', error);
      return [];
    }
  }

  /**
   * Extract meetings using OpenAI GPT
   */
  private async extractWithOpenAI(
    systemPrompt: string,
    fullTranscript: string,
    hasAvailabilityChecker: boolean
  ): Promise<any[]> {
    const model = LLM_CONFIG.models.openai;
    console.log(`🤖 Using OpenAI model: ${model}`);

    // Build message array
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: fullTranscript },
    ];

    // If availability checker exists, use Function Calling
    if (hasAvailabilityChecker) {
      console.log('🔧 Using Function Calling to check availability...');
      
      let response = await this.openai!.chat.completions.create({
        model,
        messages,
        tools: openaiTools,
        tool_choice: 'auto',
        reasoning_effort: 'none',
      } as any);

      let message = response.choices[0].message;
      messages.push(message);

      // Loop to process tool calls
      let iterationCount = 0;
      const maxIterations = 10; // Prevent infinite loop

      while (message.tool_calls && message.tool_calls.length > 0 && iterationCount < maxIterations) {
        iterationCount++;
        console.log(`🔄 Processing tool calls (iteration ${iterationCount})...`);

        for (const toolCall of message.tool_calls) {
          if (toolCall.function.name === 'check_availability') {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              const startHour = args.start_hour ?? 9;
              const endHour = args.end_hour ?? 18;
              console.log(`📅 Checking availability for: ${args.participants?.join(', ')} on ${args.date} (${startHour}:00 - ${endHour}:00)`);
              
              // Call actual availability check
              const availability = await this.availabilityChecker!(
                args.date,
                args.participants || [],
                args.duration || 30,
                startHour,
                endHour
              );

              console.log(`✅ Found ${availability.availableSlots.filter(s => s.isFree).length} available slots`);
              if (availability.firstAvailableTime) {
                console.log(`📍 First available time: ${new Date(availability.firstAvailableTime).toLocaleString()}`);
              }

              // Return result to GPT
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(availability),
              });
            } catch (error) {
              console.error('Error in check_availability:', error);
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: 'Failed to check availability', message: String(error) }),
              });
            }
          }
        }

        // Continue conversation, let GPT give final answer based on tool results
        response = await this.openai!.chat.completions.create({
          model,
          messages,
          tools: openaiTools,
          tool_choice: 'auto',
          reasoning_effort: 'none',
        } as any);

        message = response.choices[0].message;
        messages.push(message);
      }

      // Parse final result
      const content = message.content || '{}';
      console.log('🔍 GPT final response content:', content);
      
      return this.parseJsonResponse(content);
    } else {
      // No availability checker, use original method
      const response = await this.openai!.chat.completions.create({
        model,
        messages,
        response_format: { type: 'json_object' },
        reasoning_effort: 'none',
      } as any);

      const result = JSON.parse(response.choices[0].message.content || '{}');
      
      console.log('📊 Meeting analysis:', result.analysis);
      console.log(`✅ Found ${result.meetings?.length || 0} new meetings to create`);
      
      return result.meetings || [];
    }
  }

  /**
   * Extract meetings using Anthropic Claude
   */
  private async extractWithAnthropic(
    systemPrompt: string,
    fullTranscript: string,
    hasAvailabilityChecker: boolean
  ): Promise<any[]> {
    const model = LLM_CONFIG.models.anthropic;
    console.log(`🤖 Using Anthropic model: ${model}`);

    // Build message array
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: fullTranscript },
    ];

    // If availability checker exists, use Tool Use
    if (hasAvailabilityChecker) {
      console.log('🔧 Using Tool Use to check availability...');
      
      let response = await this.anthropic!.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: anthropicTools,
      });

      // Loop to process tool calls
      let iterationCount = 0;
      const maxIterations = 10; // Prevent infinite loop

      while (response.stop_reason === 'tool_use' && iterationCount < maxIterations) {
        iterationCount++;
        console.log(`🔄 Processing tool calls (iteration ${iterationCount})...`);

        // Find all tool use blocks
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );

        // Build tool results
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          if (toolUse.name === 'check_availability') {
            try {
              const args = toolUse.input as any;
              const startHour = args.start_hour ?? 9;
              const endHour = args.end_hour ?? 18;
              console.log(`📅 Checking availability for: ${args.participants?.join(', ')} on ${args.date} (${startHour}:00 - ${endHour}:00)`);
              
              // Call actual availability check
              const availability = await this.availabilityChecker!(
                args.date,
                args.participants || [],
                args.duration || 30,
                startHour,
                endHour
              );

              console.log(`✅ Found ${availability.availableSlots.filter(s => s.isFree).length} available slots`);
              if (availability.firstAvailableTime) {
                console.log(`📍 First available time: ${new Date(availability.firstAvailableTime).toLocaleString()}`);
              }

              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify(availability),
              });
            } catch (error) {
              console.error('Error in check_availability:', error);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify({ error: 'Failed to check availability', message: String(error) }),
                is_error: true,
              });
            }
          }
        }

        // Add assistant message and tool results
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });

        // Continue conversation
        response = await this.anthropic!.messages.create({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages,
          tools: anthropicTools,
        });
      }

      // Extract final text content
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );
      const content = textBlock?.text || '{}';
      console.log('🔍 Claude final response content:', content);
      
      return this.parseJsonResponse(content);
    } else {
      // No availability checker, directly request JSON
      const response = await this.anthropic!.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt + '\n\nRespond with ONLY a valid JSON object, no other text.',
        messages,
      });

      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );
      const content = textBlock?.text || '{}';
      
      return this.parseJsonResponse(content);
    }
  }

  /**
   * Parse JSON response from LLM
   */
  private parseJsonResponse(content: string): any[] {
    // Try to extract JSON from content
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('⚠️ No JSON found in LLM response, returning empty meetings');
      return [];
    }
    
    try {
      const result = JSON.parse(jsonMatch[0]);
      console.log('📊 Meeting analysis:', result.analysis);
      console.log(`✅ Found ${result.meetings?.length || 0} new meetings to create`);
      return result.meetings || [];
    } catch (parseError) {
      console.error('❌ Failed to parse LLM response as JSON:', parseError);
      console.error('Raw content:', jsonMatch[0]);
      return [];
    }
  }
}
