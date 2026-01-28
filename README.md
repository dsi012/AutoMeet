# Meeting Scheduler

AI-powered macOS desktop app that listens to conversations in real time and creates calendar events when it detects scheduling intent.

## Demo

![Demo](assets/demo.gif)

*A quick demonstration of the app in action - real-time transcription, intent detection, and automatic calendar event creation.*

---

## Features

- **Real-time Audio Transcription** - Uses ElevenLabs Scribe v2 for high-quality speech-to-text
- **AI-Powered Intent Detection** - Leverages LLM to detect meeting scheduling intents
- **Automatic Calendar Integration** - Google Calendar
- **Smart Meeting Extraction** - Uses GPT-4o to extract participants, time, topic, and duration
- **Modern UI** - Beautiful interface built with React and Tailwind CSS
- **Secure Storage** - API credentials stored locally with encryption
- **System Audio Capture** - Captures both microphone and system audio (macOS 13.0+)
- **Contact Management** - Automatic contact lookup and participant matching

## System Requirements

- **macOS 13.0 (Ventura)** or later
- Node.js 18+
- Xcode Command Line Tools (needed to build the native module)

## Quick start

```bash
xcode-select --install
npm install
npm run dev
```

## Configuration

Open the app → **Settings** and fill in:

- **ElevenLabs API key** (required)
- **OpenAI API key** (required)
- **Google Calendar**: OAuth Client ID/Secret (Desktop app) with redirect URI `http://localhost`

### Google Calendar Setup

1. Visit [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable **Google Calendar API**
4. Create OAuth 2.0 credentials:
   - Application type: **Desktop app**
   - Redirect URI: `http://localhost`
5. Copy **Client ID** and **Client Secret**
6. Enter them in the app Settings

## Usage

### First Time Setup

1. **Launch the app**: `npm run dev` (or run the built app)
2. **Grant permissions**:
   - Microphone access (required for audio capture)
   - Screen recording access (required for system audio capture on macOS)
3. **Configure API keys** via Settings
4. **Connect calendar**:
   - Click "Connect Google Account" and authorize

### Using the App

1. **Start Listening**: Click the "Start Listening" button
2. **Speak naturally**: The app will transcribe your conversation
3. **Automatic detection**: When a meeting intent is detected:
   - The app extracts meeting details (participants, time, topic)
   - Creates a calendar event automatically
4. **View results**: Check the Meeting Panel for created events

### Example Phrases

The app detects phrases like:
- "Let's schedule a meeting with John tomorrow at 3pm"
- "Can we set up a call with Sarah and Mike next week?"
- "I need to meet with the team on Friday afternoon"

## Development

```bash
# dev
npm run dev

# build
npm run build

# package (macOS)
npm run dist:mac
```

## Troubleshooting

- **Microphone permission**: System Settings → Privacy & Security → Microphone
- **System audio capture**: System Settings → Privacy & Security → Screen Recording
- **Google auth fails**: ensure Google Calendar API is enabled and `http://localhost` is an authorized redirect URI
- **Native build fails**:

```bash
cd native
rm -rf build node_modules
npm install
npm run install
```

## License

MIT
