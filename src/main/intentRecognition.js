"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntentRecognitionService = void 0;
const openai_1 = __importDefault(require("openai"));
// Define tools callable by GPT
const tools = [
    {
        type: 'function',
        function: {
            name: 'check_availability',
            description: 'Check free/busy time slots for specified participants on a given date within a specific time range. Returns available slots and the first available time.',
            parameters: {
                type: 'object',
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
            },
        },
    },
];
class IntentRecognitionService {
    constructor(apiKey) {
        this.transcriptBuffer = [];
        this.contactsMap = null;
        this.availabilityChecker = null;
        this.openai = new openai_1.default({ apiKey });
    }
    setContactsMap(contacts) {
        this.contactsMap = contacts;
    }
    /**
     * Set the availability checker callback function.
     * This will be called by GPT to check calendar availability.
     */
    setAvailabilityChecker(checker) {
        this.availabilityChecker = checker;
        console.log('✅ Availability checker set for intent recognition');
    }
    addTranscript(text) {
        this.transcriptBuffer.push(text);
    }
    clearBuffer() {
        this.transcriptBuffer = [];
    }
    getFullTranscript() {
        return this.transcriptBuffer.join('\n');
    }
    /**
     * Extract all meetings from the complete transcript when recording stops.
     * Uses Function Calling to check calendar availability before suggesting times.
     */
    async extractAllMeetingsFromTranscript(fullTranscript, createdMeetings) {
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
                    return `${i + 1}. Title: "${m.title || 'Untitled'}" | Participants: ${m.participants?.join(', ') || 'none'} | Time: ${dateStr}`;
                })
                    .join('\n');
                createdMeetingsContext = `
ALREADY CREATED MEETINGS (do NOT include these):
${meetingsList}
`;
            }
            // Build contacts list with timezone information
            let contactsList = '';
            if (this.contactsMap) {
                const contacts = [];
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
- Avoid scheduling during nighttime (10 PM - 6 AM) in any participant's timezone
- If perfect overlap isn't possible, prioritize times that are reasonable for the majority

When calling check_availability, use start_hour and end_hour to specify the time range:
- EXACT time specified (e.g., "1 PM", "3:00 PM") → Use that exact hour (e.g., start_hour: 13, end_hour: 14)
- "3 PM onwards" → start_hour: 15, end_hour: 18
- "morning" → start_hour: 9, end_hour: 12
- "afternoon" → start_hour: 13, end_hour: 17
- "after 2 PM" → start_hour: 14, end_hour: 18
- "evening" → start_hour: 17, end_hour: 20
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
            // Build message array
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: fullTranscript },
            ];
            // If availability checker exists, use Function Calling
            if (hasAvailabilityChecker) {
                console.log('🔧 Using Function Calling to check availability...');
                let response = await this.openai.chat.completions.create({
                    model: 'gpt-5.2',
                    messages,
                    tools,
                    tool_choice: 'auto',
                    reasoning: {
                        effort: 'none',
                    },
                });
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
                                const availability = await this.availabilityChecker(args.date, args.participants || [], args.duration || 30, startHour, endHour);
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
                            }
                            catch (error) {
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
                    response = await this.openai.chat.completions.create({
                        model: 'gpt-5.2',
                        messages,
                        tools,
                        tool_choice: 'auto',
                        reasoning: {
                            effort: 'none',
                        },
                    });
                    message = response.choices[0].message;
                    messages.push(message);
                }
                // Parse final result
                const content = message.content || '{}';
                console.log('🔍 GPT final response content:', content);
                // Try to extract JSON from content
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    console.warn('⚠️ No JSON found in GPT response, returning empty meetings');
                    return [];
                }
                try {
                    const result = JSON.parse(jsonMatch[0]);
                    console.log('📊 Meeting analysis:', result.analysis);
                    console.log(`✅ Found ${result.meetings?.length || 0} new meetings to create`);
                    return result.meetings || [];
                }
                catch (parseError) {
                    console.error('❌ Failed to parse GPT response as JSON:', parseError);
                    console.error('Raw content:', jsonMatch[0]);
                    return [];
                }
            }
            else {
                // No availability checker, use original method
                const response = await this.openai.chat.completions.create({
                    model: 'gpt-5.2',
                    messages,
                    response_format: { type: 'json_object' },
                    reasoning: {
                        effort: 'none',
                    },
                });
                const result = JSON.parse(response.choices[0].message.content || '{}');
                console.log('📊 Meeting analysis:', result.analysis);
                console.log(`✅ Found ${result.meetings?.length || 0} new meetings to create`);
                return result.meetings || [];
            }
        }
        catch (error) {
            console.error('Error extracting meetings from transcript:', error);
            return [];
        }
    }
}
exports.IntentRecognitionService = IntentRecognitionService;
