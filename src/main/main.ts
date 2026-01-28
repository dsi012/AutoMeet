import { app, BrowserWindow, ipcMain, systemPreferences, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Load .env file before other imports that might use env vars
dotenv.config({ path: path.join(app.getAppPath(), '.env') });
// Also try loading from current working directory (for development)
dotenv.config();

// Setup logging as early as possible
import { setupGlobalLogging, getLogger } from './logger';
setupGlobalLogging();
const logger = getLogger();

import { TranscriptionService } from './transcriptionService';
import { IntentRecognitionService, AvailabilityResult, TimeSlot } from './intentRecognition';
import { CalendarService } from './calendarService';
import { ContactService } from './contactService';
import { AudioCapture } from './audioCapture';
import { AudioMixer } from './audioMixer';
import { getConfig, isConfigured, getMissingKeys } from './config';

// Settings file path
const SETTINGS_FILE_PATH = path.join(app.getPath('userData'), 'settings.json');

// Load persisted settings
function loadPersistedSettings(): any {
  try {
    if (fs.existsSync(SETTINGS_FILE_PATH)) {
      const data = fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8');
      const settings = JSON.parse(data);
      console.log('✅ Loaded persisted settings from:', SETTINGS_FILE_PATH);
      return settings;
    }
  } catch (error) {
    console.error('Error loading persisted settings:', error);
  }
  return null;
}

// Save settings to disk
function savePersistedSettings(settings: any): void {
  try {
    // Ensure userData directory exists
    const userDataDir = app.getPath('userData');
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    
    fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2), 'utf-8');
    console.log('✅ Settings saved to:', SETTINGS_FILE_PATH);
  } catch (error) {
    console.error('Error saving settings:', error);
    throw error;
  }
}

// Mitigate macOS/Electron audio service crashes when capturing microphone input
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess');
app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let transcriptionService: TranscriptionService | null = null;
let intentService: IntentRecognitionService | null = null;
let calendarService: CalendarService | null = null;
let contactService: ContactService | null = null;
let audioCapture: AudioCapture | null = null;
let audioMixer: AudioMixer | null = null;

// Store created meetings in memory
interface CreatedMeeting {
  id: string;
  title?: string;
  participants: string[];
  startTime: Date;
  endTime: Date;
  createdAt: Date;
  googleEventId?: string; // Google Calendar event ID for updates
  deleted?: boolean; // Mark as deleted to prevent AI from recreating
}

const createdMeetings: CreatedMeeting[] = [];

// Store pending meetings waiting for user confirmation
interface PendingMeeting {
  id: string;
  meetingDetails: any;
  suggestedStartTime: Date;
  suggestedEndTime: Date;
  hasConflict: boolean;
  timeSlots: Array<{ startTime: Date; endTime: Date; isFree: boolean }>;
}

const pendingMeetings: Map<string, PendingMeeting> = new Map();

function createWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;
  
  const windowWidth = 300; // Initially only show meetings panel
  const windowX = Math.floor((screenWidth - windowWidth) / 2);
  
  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: 28, // Initial height only shows top edge
    minWidth: 280, // Minimum width
    minHeight: 28,
    maxHeight: 1200,
    x: windowX,
    y: 0,
    title: 'Meeting Scheduler',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: false, // Frameless window
    transparent: true, // Transparent window
    alwaysOnTop: true, // Always on top
    resizable: false, // Disable resizing
    movable: true, // Allow dragging
    hasShadow: false, // No shadow
  });

  // Monitor renderer health
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(
      '[Renderer] process gone:',
      details.reason,
      'exitCode=',
      details.exitCode,
    );
    console.error('[Renderer] details:', JSON.stringify(details));
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[Renderer] became unresponsive');
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools(); // Commented out auto-open dev tools
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  // Initialize audio capture
  audioCapture = new AudioCapture(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
    audioCapture = null;
  });
}

// Window expand/collapse state
let isExpanded = false;
const COLLAPSED_HEIGHT = 28;

// Calculate expanded height as 40% of screen height for more compact panel
function getExpandedHeight(): number {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { height: screenHeight } = primaryDisplay.workAreaSize;
  return Math.floor(screenHeight * 0.50);
}

function toggleWindowExpansion() {
  if (!mainWindow) return;
  
  isExpanded = !isExpanded;
  const targetHeight = isExpanded ? getExpandedHeight() : COLLAPSED_HEIGHT;
  
  // Keep current position, only change height
  const currentBounds = mainWindow.getBounds();
  
  // Smooth animation - keep current position
  mainWindow.setBounds({
    x: currentBounds.x,
    y: currentBounds.y,
    width: currentBounds.width,
    height: targetHeight,
  }, true);
}

// Request microphone permission on macOS
async function requestMicrophonePermission(): Promise<boolean> {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    
    if (status === 'not-determined') {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      return granted;
    }
    
    return status === 'granted';
  }
  
  return true; // On other platforms, assume permission is granted
}

/**
 * Check calendar availability for participants on a given date.
 * This function is called by GPT via Function Calling.
 * 
 * @param date - Date in YYYY-MM-DD format
 * @param participants - List of participant names
 * @param duration - Meeting duration in minutes
 * @param startHour - Start hour of search range (0-23, Pacific timezone)
 * @param endHour - End hour of search range (0-23, Pacific timezone)
 */
async function checkCalendarAvailability(
  date: string,
  participants: string[],
  duration: number,
  startHour: number = 9,
  endHour: number = 18
): Promise<AvailabilityResult> {
  console.log(`🔍 Checking availability: date=${date}, participants=${participants.join(', ')}, duration=${duration}min, range=${startHour}:00-${endHour}:00`);
  
  // Parse target date (in Pacific timezone)
  const isPDT = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' }).includes('PDT');
  const tzOffset = isPDT ? '-07:00' : '-08:00';
  const targetDate = new Date(date + 'T00:00:00' + tzOffset);
  
  // Get time slots from Google Calendar
  let timeSlots: Array<{ startTime: Date; endTime: Date; isFree: boolean }> = [];
  
  try {
    if (calendarService?.isAuthenticated()) {
      // Use attendee-aware time slots for Google Calendar
      const attendeeEmails = contactService?.getEmails(participants) || [];
      timeSlots = await calendarService.getTimeSlotsWithAttendees(targetDate, duration, attendeeEmails);
    }
  } catch (error) {
    console.error('Error getting time slots:', error);
  }

  // Filter by hour range (in Pacific timezone)
  const filteredSlots = timeSlots.filter(slot => {
    const hour = parseInt(slot.startTime.toLocaleString('en-US', { 
      timeZone: 'America/Los_Angeles', 
      hour: 'numeric', 
      hour12: false 
    }));
    return hour >= startHour && hour < endHour;
  });

  // Convert to API format
  const apiSlots: TimeSlot[] = filteredSlots.map(slot => ({
    startTime: slot.startTime.toISOString(),
    endTime: slot.endTime.toISOString(),
    isFree: slot.isFree,
  }));

  // Find first available time in the specified range
  const firstFreeSlot = apiSlots.find(slot => slot.isFree);
  
  const result: AvailabilityResult = {
    date,
    participants,
    duration,
    startHour,
    endHour,
    availableSlots: apiSlots,
    firstAvailableTime: firstFreeSlot?.startTime,
  };

  console.log(`📊 Availability result: ${apiSlots.filter(s => s.isFree).length} free slots, first available: ${firstFreeSlot?.startTime || 'none'}`);
  
  return result;
}

// Initialize services with built-in API keys or user settings
function initializeServices(settings?: any) {
  // Get built-in configuration
  const builtInConfig = getConfig();
  
  // Use built-in config as default, allow user settings to override
  const finalConfig = {
    elevenlabsApiKey: settings?.elevenlabsApiKey || builtInConfig.elevenlabsApiKey,
    openaiApiKey: settings?.openaiApiKey || builtInConfig.openaiApiKey,
    anthropicApiKey: settings?.anthropicApiKey || builtInConfig.anthropicApiKey,
    googleClientId: settings?.googleClientId || builtInConfig.googleClientId,
    googleClientSecret: settings?.googleClientSecret || builtInConfig.googleClientSecret,
  };

  // Initialize contact service (doesn't need API keys)
  if (!contactService) {
    contactService = new ContactService();
    
    // Set up callback to update intent service when contacts are loaded
    const cs = contactService; // Capture for closure
    contactService.onContactsUpdated(() => {
      if (intentService) {
        console.log('🔄 Updating intent service with latest contacts');
        intentService.setContactsMap(cs.getAllContacts());
      }
    });
  }

  if (finalConfig.elevenlabsApiKey) {
    transcriptionService = new TranscriptionService({
      apiKey: finalConfig.elevenlabsApiKey,
    });
  }

  if (finalConfig.openaiApiKey) {
    intentService = new IntentRecognitionService(
      finalConfig.openaiApiKey,
      finalConfig.anthropicApiKey || undefined
    );
    // Pass contacts to intent service so GPT can look them up
    if (contactService) {
      intentService.setContactsMap(contactService.getAllContacts());
    }
    // Set up availability checker for GPT Function Calling
    intentService.setAvailabilityChecker(checkCalendarAvailability);
  }

  if (finalConfig.googleClientId && finalConfig.googleClientSecret) {
    calendarService = new CalendarService(
      finalConfig.googleClientId,
      finalConfig.googleClientSecret,
      'http://localhost'
    );
  }
}

// Handle transcription
async function startTranscription() {
  if (!transcriptionService || !intentService) {
    const errorMsg = 'Services not initialized. Please configure API keys in settings.';
    console.error(errorMsg);
    mainWindow?.webContents.send('transcription-error', { error: errorMsg });
    return;
  }

  try {
    // Start native audio capture if available
    const nativeCapture = audioCapture;
    const nativeAvailable = nativeCapture?.isUsingNativeCapture() ?? false;
    const nativeSupportsMic = nativeCapture?.supportsMicrophoneCapture() ?? false;
    const needsAudioMixer = nativeAvailable && !nativeSupportsMic;

    if (needsAudioMixer) {
      audioMixer = new AudioMixer((buffer: Buffer) => {
        if (transcriptionService) {
          transcriptionService.sendAudio(buffer);
        }
      });
      audioMixer.start(); // Start periodic output
      console.log('🎚️ Audio mixer enabled (native system audio + Web Audio microphone)');
    } else {
      audioMixer = null;
    }

    if (nativeAvailable && nativeCapture) {
      console.log('🎙️ Starting native ScreenCaptureKit audio capture...');
      
      // Set up callback first
      nativeCapture.setAudioDataCallback((audioData: Buffer) => {
        if (!transcriptionService) {
          return;
        }

        if (needsAudioMixer && audioMixer) {
          audioMixer.addSystemChunk(audioData);
        } else {
          transcriptionService.sendAudio(audioData);
        }
      });
      
      // Start capturing system audio only (microphone is handled via Web Audio API)
      await nativeCapture.startCapture(true, false);
      console.log('✅ Native audio capture started (system audio only, mic via Web Audio)');
    } else {
      console.log('⚠️ Native ScreenCaptureKit capture not available. Using Web Audio API only.');
    }

    await transcriptionService.connect(
      async (text: string, isFinal: boolean) => {
        // Send transcript to renderer
        mainWindow?.webContents.send('transcription-data', {
          text,
          isFinal,
          timestamp: new Date().toISOString(),
        });

        // Update activity time for any transcript (partial or final)
        // This ensures idle detection knows we're still receiving speech
        if (intentService) {
          if (isFinal) {
            // Final transcript: add to buffer for analysis
            intentService.addTranscript(text);
          } else {
            // Partial transcript: just update the activity time
            intentService.updateLastTranscriptTime();
          }
        }
      },
      (connected: boolean, error?: string) => {
        // Send connection status to frontend
        mainWindow?.webContents.send('transcription-status', {
          connected,
          error,
          timestamp: new Date().toISOString(),
        });
        
        if (!connected && error) {
          console.error('⚠️ Transcription connection issue:', error);
        }
      }
    );

    // Start idle monitoring: analyze transcript if no new content for 20 seconds
    if (intentService) {
      intentService.setIdleAnalysisCallback(async () => {
        await analyzeTranscriptForMeetings();
      });
      intentService.startIdleMonitoring();
    }

    console.log('Transcription started');
  } catch (error: any) {
    console.error('Failed to start transcription:', error);
    const errorMessage = error?.message || 'Unknown error occurred';
    mainWindow?.webContents.send('transcription-error', { error: errorMessage });
  }
}

/**
 * Analyze the current transcript for meeting requests
 * Called both during idle periods (20s without new transcript) and when stopping recording
 */
async function analyzeTranscriptForMeetings() {
  // Check if intent service is available
  if (!intentService) {
    return;
  }
  
  // Check Google Calendar authentication
  const isCalendarReady = calendarService?.isAuthenticated();
  
  if (!isCalendarReady) {
    console.log('⏭️ Skipping analysis: Google Calendar not authenticated');
    return;
  }

  // Skip if no new content since last analysis (prevents duplicate analysis on stop)
  if (!intentService.hasNewContentSinceLastAnalysis()) {
    console.log('⏭️ Skipping analysis: no new content since last analysis');
    return;
  }

  const fullTranscript = intentService.getFullTranscript();
  if (!fullTranscript) {
    return;
  }

  console.log('🔍 Analyzing transcript for unscheduled meetings...');
  mainWindow?.webContents.send('analyzing-meetings', { status: 'started' });
  
  // Mark analysis time at START, not end
  // This ensures transcripts received during analysis will trigger a new analysis later
  intentService.markAnalysisPerformed();
  
  try {
    const newMeetings = await intentService.extractAllMeetingsFromTranscript(
      fullTranscript,
      createdMeetings
    );
    
    if (newMeetings.length === 0) {
      console.log('✅ All meetings already scheduled or no meetings found');
      mainWindow?.webContents.send('analyzing-meetings', { 
        status: 'complete', 
        message: 'All meetings already scheduled' 
      });
    } else {
      console.log(`📅 Processing ${newMeetings.length} new meetings...`);
      
      for (const meeting of newMeetings) {
        try {
          await processMeetingWithConflictCheck(meeting);
        } catch (error) {
          console.error(`❌ Failed to process meeting: ${meeting.title}`, error);
        }
      }
      
      mainWindow?.webContents.send('analyzing-meetings', { 
        status: 'complete', 
        message: `Processed ${newMeetings.length} meetings` 
      });
    }
  } catch (error) {
    console.error('Error analyzing transcript:', error);
    mainWindow?.webContents.send('analyzing-meetings', { 
      status: 'error', 
      message: 'Failed to analyze transcript' 
    });
  }
}

async function stopTranscription() {
  // Stop idle monitoring first
  if (intentService) {
    intentService.stopIdleMonitoring();
  }
  
  // Stop audio mixer FIRST to prevent it from calling sendAudio after WebSocket is closed
  if (audioMixer) {
    audioMixer.stop();
    audioMixer.reset();
    audioMixer = null;
  }
  
  // Stop native audio capture
  if (audioCapture && audioCapture.isUsingNativeCapture()) {
    audioCapture.stopCapture();
    console.log('Native audio capture stopped');
  }

  // Disconnect transcription service LAST
  if (transcriptionService) {
    transcriptionService.disconnect();
    console.log('Transcription stopped');
  }

  // Analyze full transcript one final time when recording stops
  await analyzeTranscriptForMeetings();
  
  // NOTE: Do NOT clear transcript buffer here!
  // Keep the transcript so subsequent recordings maintain context
  // User can manually clear via UI if needed
}

/**
 * Process a meeting request - check for conflicts and either create directly or send to pending
 */
async function processMeetingWithConflictCheck(meetingDetails: any) {
  if (!calendarService) {
    throw new Error('Calendar service not initialized');
  }

  const duration = meetingDetails.duration || 30;
  let suggestedStartTime: Date;
  let targetDate: Date | undefined;
  
  // Get attendee names for Google Calendar
  const attendeeNames = meetingDetails.participants || [];
  
  // Parse the suggested date/time
  if (meetingDetails.suggestedDate) {
    let dateStr = meetingDetails.suggestedDate;
    
    if (!dateStr.includes('Z') && !dateStr.includes('+') && !dateStr.match(/-\d{2}:\d{2}$/)) {
      const isPDT = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' }).includes('PDT');
      const tzOffset = isPDT ? '-07:00' : '-08:00';
      
      if (!dateStr.includes('T')) {
        dateStr = dateStr + 'T00:00:00' + tzOffset;
      } else {
        dateStr = dateStr + tzOffset;
      }
    }
    
    const parsed = new Date(dateStr);
    
    if (!isNaN(parsed.getTime())) {
      suggestedStartTime = parsed;
      targetDate = parsed;
      
      // Check if time was specified
      const pacificHour = parseInt(parsed.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }));
      const pacificMinute = parseInt(parsed.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', minute: 'numeric' }));
      const hasTime = pacificHour !== 0 || pacificMinute !== 0;
      
      if (!hasTime) {
        // No time specified, find first available slot
        const attendeeEmails = contactService?.getEmails(attendeeNames) || [];
        suggestedStartTime = await calendarService.findNextAvailableSlotWithAttendees(parsed, duration, attendeeEmails);
      }
    } else {
      const attendeeEmails = contactService?.getEmails(attendeeNames) || [];
      suggestedStartTime = await calendarService.findNextAvailableSlotWithAttendees(undefined, duration, attendeeEmails);
      targetDate = suggestedStartTime;
    }
  } else {
    const attendeeEmails = contactService?.getEmails(attendeeNames) || [];
    suggestedStartTime = await calendarService.findNextAvailableSlotWithAttendees(undefined, duration, attendeeEmails);
    targetDate = suggestedStartTime;
  }

  const suggestedEndTime = new Date(suggestedStartTime.getTime() + duration * 60 * 1000);
  
  // Check for attendees' conflicts and get time slots using Google Calendar
  let hasConflict = false;
  let conflictDetails: string[] = [];
  let timeSlots: Array<{ startTime: Date; endTime: Date; isFree: boolean }> = [];
  
  const attendeeEmails = contactService?.getEmails(attendeeNames) || [];
  
  if (attendeeEmails.length > 0) {
    try {
      const conflictCheck = await calendarService.checkAttendeesConflict(
        attendeeEmails,
        suggestedStartTime,
        suggestedEndTime
      );
      
      hasConflict = conflictCheck.hasConflict;
      
      if (hasConflict) {
        for (const conflict of conflictCheck.conflicts) {
          const name = attendeeNames.find((n: string) => {
            const email = contactService!.getEmail(n);
            return email === conflict.email;
          }) || conflict.email;
          conflictDetails.push(`${name} (${conflict.busySlots} conflict(s))`);
        }
      }
    } catch (error) {
      console.error('Error checking Google Calendar attendee conflicts:', error);
    }
  }
  
  // Use Google Calendar to get time slots (including attendee availability)
  timeSlots = await calendarService.getTimeSlotsWithAttendees(targetDate || suggestedStartTime, duration, attendeeEmails);
  
  const pendingId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  
  if (hasConflict) {
    console.log(`📅 Meeting "${meetingDetails.title}" - ⚠️ Conflict detected: ${conflictDetails.join(', ')}`);
  } else {
    console.log(`📅 Meeting "${meetingDetails.title}" - ✅ No conflicts, all attendees are free`);
  }
  
  // Store as pending meeting
  pendingMeetings.set(pendingId, {
    id: pendingId,
    meetingDetails,
    suggestedStartTime,
    suggestedEndTime,
    hasConflict,
    timeSlots,
  });

  // Send to frontend for user confirmation
  mainWindow?.webContents.send('meeting-pending', {
    pendingId,
    title: meetingDetails.title || 'Meeting',
    participants: meetingDetails.participants || [],
    suggestedTime: suggestedStartTime.toISOString(),
    duration,
    hasConflict,
    timeSlots: timeSlots.map(slot => ({
      startTime: slot.startTime.toISOString(),
      endTime: slot.endTime.toISOString(),
      isFree: slot.isFree,
    })),
  });
}

async function createMeetingEvent(meetingDetails: any, providedStartTime?: Date) {
  if (!calendarService) {
    throw new Error('Calendar service not initialized');
  }

  const duration = meetingDetails.duration || 30;
  
  // Use provided start time if available, otherwise use default (tomorrow 10 AM)
  const eventStartTime = providedStartTime || new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (!providedStartTime) {
    eventStartTime.setHours(10, 0, 0, 0);
  }
  
  console.log('📅 Creating meeting at:', eventStartTime.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));

  const endTime = new Date(eventStartTime.getTime() + duration * 60 * 1000);

  // Convert participant names to contact info (emails/mobiles) using ContactService
  const participantNames = meetingDetails.participants || [];
  const contactInfo = contactService?.getContactInfo(participantNames) || { emails: [], mobiles: [] };
  const participantEmails = contactInfo.emails;
  const attendees = participantEmails.map((email: string) => ({ email }));
  console.log(`Creating event with ${attendees.length} attendees (from ${participantNames.length} names)`);

  const description = meetingDetails.description || '';

  let createdEvent: any;

  // Use Google Calendar
  console.log('📅 Using Google Calendar for event creation');
  
  try {
    const googleEvent = await calendarService.createCalendarEvent(
        meetingDetails.title || 'Meeting',
        description,
        eventStartTime,
        endTime,
        participantEmails,
        true  // Add Google Meet link
      );
      
      console.log(`✅ Google calendar event created: ${googleEvent.event_id}`);
      
      // Create a compatible event object
      createdEvent = {
        id: googleEvent.event_id,
        summary: googleEvent.summary,
        htmlLink: googleEvent.htmlLink || googleEvent.meetLink,
        start: {
          dateTime: eventStartTime.toISOString(),
        },
        end: {
          dateTime: endTime.toISOString(),
        },
        attendees: participantNames.map((name: string) => ({ email: name })),
      };
    } catch (error) {
      console.error('Failed to create Google calendar event:', error);
      throw error;
    }
  
  const meetingId = meetingDetails.id || Date.now().toString();
  
  // Store meeting in memory for GPT to check duplicates
  // Use participantNames (original names) instead of emails so GPT can match them correctly
  const createdMeeting: CreatedMeeting = {
    id: meetingId,
    title: meetingDetails.title || 'Meeting',
    participants: participantNames,  // Store names, not emails, for GPT matching
    startTime: eventStartTime,
    endTime,
    createdAt: new Date(),
    googleEventId: createdEvent.id,
  };
  createdMeetings.push(createdMeeting);
  
  // Keep only last 50 meetings to avoid memory issues
  if (createdMeetings.length > 50) {
    createdMeetings.shift();
  }
  
  mainWindow?.webContents.send('meeting-created', {
    meetingId,
    eventLink: createdEvent.htmlLink,
    event: createdEvent,
  });

  return createdEvent;
}

// App lifecycle
// Migrate old contacts.csv to new contacts/ directory
function migrateOldContactsFile() {
  try {
    const oldPath = path.join(app.getAppPath(), 'contacts.csv');
    const newDir = path.join(app.getAppPath(), 'contacts');
    const newPath = path.join(newDir, 'contacts.csv');
    
    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
      console.log('📦 Migrating old contacts.csv to new directory...');
      
      // Create new directory
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }
      
      // Copy file
      fs.copyFileSync(oldPath, newPath);
      
      // Delete old file
      fs.unlinkSync(oldPath);
      
      console.log('✅ Migration complete');
    }
  } catch (error) {
    console.error('Error migrating contacts file:', error);
  }
}

app.whenReady().then(async () => {
  // Migrate old contacts file if exists
  migrateOldContactsFile();
  
  createWindow();

  // Try to load persisted settings first
  const persistedSettings = loadPersistedSettings();
  
  if (persistedSettings && Object.keys(persistedSettings).length > 0) {
    console.log('✅ Auto-initializing with persisted settings...');
    initializeServices(persistedSettings);
  } else if (isConfigured()) {
    console.log('✅ Auto-initializing with built-in API keys...');
    initializeServices();
  } else {
    console.log('⚠️  No settings found. User will need to configure in settings.');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Close logger before quitting
  logger.close();
});

// IPC Handlers
ipcMain.handle('request-microphone-permission', async () => {
  return await requestMicrophonePermission();
});

ipcMain.handle('get-microphone-status', () => {
  if (process.platform === 'darwin') {
    return systemPreferences.getMediaAccessStatus('microphone');
  }
  return 'granted';
});

ipcMain.handle('initialize-services', (_event, settings) => {
  // Save settings to disk for persistence
  if (settings && Object.keys(settings).length > 0) {
    savePersistedSettings(settings);
  }
  
  // Re-initialize with user-provided settings if any
  initializeServices(settings);
  return { success: true };
});

// Save settings
ipcMain.handle('save-settings', (_event, settings) => {
  if (settings && Object.keys(settings).length > 0) {
    savePersistedSettings(settings);
  }
  return { success: true };
});

// Load settings
ipcMain.handle('load-settings', () => {
  return loadPersistedSettings();
});

ipcMain.handle('get-built-in-config', () => {
  // Return built-in config status (without exposing actual keys)
  const config = getConfig();
  const persistedSettings = loadPersistedSettings();
  
  return {
    hasElevenlabsKey: !!config.elevenlabsApiKey || !!persistedSettings?.elevenlabsApiKey,
    hasOpenaiKey: !!config.openaiApiKey || !!persistedSettings?.openaiApiKey,
    hasGoogleCredentials: !!(config.googleClientId && config.googleClientSecret) || 
                          !!(persistedSettings?.googleClientId && persistedSettings?.googleClientSecret),
    isConfigured: isConfigured() || !!persistedSettings,
    missingKeys: getMissingKeys(),
    hasPersistedSettings: !!persistedSettings,
  };
});

ipcMain.handle('start-transcription', async () => {
  await startTranscription();
  return { success: true };
});

ipcMain.on('stop-transcription', async () => {
  await stopTranscription();
});

let audioChunkCounter = 0;
let lastMicLogTime = 0;
ipcMain.on('audio-data', (_event, audioData: ArrayBuffer) => {
  audioChunkCounter++;
  
  if (!transcriptionService) {
    if (audioChunkCounter % 50 === 1) {
      console.warn('⚠️  Cannot send audio: transcription service not initialized');
    }
    return;
  }
  
  if (!transcriptionService.isConnected()) {
    if (audioChunkCounter % 50 === 1) {
      console.warn('⚠️  Cannot send audio: WebSocket not connected');
    }
    return;
  }
  
  // Convert ArrayBuffer to Buffer
  const buffer = Buffer.from(audioData);
  
  if (audioChunkCounter === 1) {
    console.log('✅ First microphone audio chunk received in main process:', buffer.length, 'bytes');
  }
  
  // Output microphone receive statistics every 30 seconds
  const now = Date.now();
  if (now - lastMicLogTime >= 30000) {
    console.log(`🎤 Microphone: ${audioChunkCounter} chunks received from renderer`);
    lastMicLogTime = now;
  }

  if (audioMixer) {
    audioMixer.addMicChunk(buffer);
    return;
  }
  
  transcriptionService.sendAudio(buffer);
});

ipcMain.handle('open-google-auth', async () => {
  if (!calendarService) {
    throw new Error('Calendar service not initialized. Please configure Google credentials in settings.');
  }
  
  await calendarService.authenticate();
  return { success: true };
});

ipcMain.handle('get-google-auth-token', () => {
  if (!calendarService) {
    return null;
  }
  return calendarService.getAuthToken();
});

ipcMain.handle('create-calendar-event', async (_event, eventData) => {
  if (!calendarService) {
    throw new Error('Calendar service not initialized');
  }
  
  return await calendarService.createEvent(eventData);
});

ipcMain.handle('delete-calendar-event', async (_event, eventId: string) => {
  // Find the meeting
  const meeting = createdMeetings.find(m => m.googleEventId === eventId);
  
  if (!meeting) {
    console.warn(`Meeting with event ID ${eventId} not found in createdMeetings`);
  }
  
  // Delete from Google Calendar
  if (!calendarService) {
    throw new Error('Calendar service not initialized');
  }
  
  await calendarService.deleteCalendarEvent(eventId, false);
  
  // Keep the meeting in createdMeetings array to prevent AI from recreating it
  // User deleting a meeting usually means "I don't want this meeting", not "reschedule it"
  // We mark it as deleted so AI knows not to recreate it
  if (meeting) {
    meeting.deleted = true;
    console.log(`🗑️ Marked meeting as deleted (kept in history): ${meeting.title || 'Untitled'}`);
  }
  
  return { success: true };
});

// Confirm and create a pending meeting with selected time
ipcMain.handle('confirm-meeting', async (_event, pendingId: string, selectedStartTime: string) => {
  const pending = pendingMeetings.get(pendingId);
  if (!pending) {
    throw new Error('Pending meeting not found');
  }
  
  const startTime = new Date(selectedStartTime);
  
  try {
    // Pass pendingId so the frontend can match the meeting
    const meetingDetailsWithId = { ...pending.meetingDetails, id: pendingId };
    await createMeetingEvent(meetingDetailsWithId, startTime);
    pendingMeetings.delete(pendingId);
    console.log(`✅ Confirmed meeting: ${pending.meetingDetails.title}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to create confirmed meeting:', error);
    throw error;
  }
});

// Cancel a pending meeting
ipcMain.handle('cancel-pending-meeting', async (_event, pendingId: string) => {
  pendingMeetings.delete(pendingId);
  return { success: true };
});

// Get all contacts from contacts.csv
ipcMain.handle('get-contacts', async () => {
  if (!contactService) {
    return [];
  }
  
  const contactsMap = contactService.getAllContacts();
  const contacts: Array<{ name: string; email?: string; mobile?: string }> = [];
  
  for (const [_, contact] of contactsMap.entries()) {
    contacts.push({ 
      name: contact.name, 
      email: contact.email,
      mobile: contact.mobile
    });
  }
  
  return contacts;
});

// Upload CSV contacts file
ipcMain.handle('upload-contacts-csv', async (_event, csvContent: string, fileName?: string) => {
  // Initialize contact service if not already initialized
  // ContactService doesn't need API keys, so it's safe to initialize anytime
  if (!contactService) {
    console.log('📋 Initializing contact service for CSV upload...');
    contactService = new ContactService();
    
    // Set up callback to update intent service when contacts are loaded
    const cs = contactService;
    contactService.onContactsUpdated(() => {
      if (intentService) {
        console.log('🔄 Updating intent service with latest contacts');
        intentService.setContactsMap(cs.getAllContacts());
      }
    });
  }
  
  try {
    const finalFileName = fileName || 'contacts.csv';
    await contactService.loadFromCSVContent(csvContent, finalFileName);
    
    // Update intent service with new contacts
    if (intentService) {
      intentService.setContactsMap(contactService.getAllContacts());
    }
    
    const totalContactCount = contactService.getAllContacts().size;
    const uploadTime = new Date().toISOString();
    
    return { 
      success: true, 
      contactCount: totalContactCount,
      uploadTime,
      fileName: finalFileName,
      message: `Successfully uploaded ${finalFileName}. Total: ${totalContactCount} contacts`,
    };
  } catch (error: any) {
    console.error('Failed to upload contacts CSV:', error);
    throw new Error(`Failed to load contacts: ${error.message || 'Unknown error'}`);
  }
});

// Get list of all CSV files
ipcMain.handle('get-contacts-files', () => {
  if (!contactService) {
    return [];
  }
  
  return contactService.getCSVFiles();
});

// Delete a CSV file
ipcMain.handle('delete-contacts-file', async (_event, fileName: string) => {
  if (!contactService) {
    throw new Error('Contact service not initialized');
  }
  
  const success = contactService.deleteCSVFile(fileName);
  
  if (success) {
    // Update intent service with remaining contacts
    if (intentService) {
      intentService.setContactsMap(contactService.getAllContacts());
    }
  }
  
  return { success };
});

// Get log file information
ipcMain.handle('get-log-info', async () => {
  return {
    logFilePath: logger.getLogFilePath(),
    logDirectory: logger.getLogDirectory(),
  };
});

// Open log directory in file explorer
ipcMain.handle('open-log-directory', async () => {
  const logDir = logger.getLogDirectory();
  shell.openPath(logDir);
  return { success: true };
});

// Get recent logs (for display in app)
ipcMain.handle('get-recent-logs', async (_event, lines: number = 100) => {
  try {
    return await logger.getRecentLogs(lines);
  } catch (error) {
    console.error('Failed to read logs:', error);
    return 'Failed to read logs';
  }
});

// Clear logs
ipcMain.handle('clear-logs', async () => {
  logger.clearLogs();
  return { success: true };
});

// Update pending meeting details
ipcMain.handle('update-pending-meeting', async (_event, pendingId: string, updates: {
  title?: string;
  participants?: string[];
  suggestedTime?: string;
  duration?: number;
}) => {
  const pending = pendingMeetings.get(pendingId);
  if (!pending) {
    throw new Error('Pending meeting not found');
  }
  
  // Update the pending meeting details
  if (updates.title !== undefined) {
    pending.meetingDetails.title = updates.title;
  }
  if (updates.participants !== undefined) {
    pending.meetingDetails.participants = updates.participants;
  }
  if (updates.duration !== undefined) {
    pending.meetingDetails.duration = updates.duration;
    pending.suggestedEndTime = new Date(pending.suggestedStartTime.getTime() + updates.duration * 60000);
  }
  if (updates.suggestedTime !== undefined) {
    const newStartTime = new Date(updates.suggestedTime);
    const duration = pending.meetingDetails.duration || 30;
    pending.suggestedStartTime = newStartTime;
    pending.suggestedEndTime = new Date(newStartTime.getTime() + duration * 60000);
    
    // Re-check conflicts and generate new time slots
    const hasConflict = await calendarService!.checkConflict(
      newStartTime,
      pending.suggestedEndTime
    );
    
    const timeSlots = await calendarService!.getTimeSlots(newStartTime, duration);
    
    pending.hasConflict = hasConflict;
    pending.timeSlots = timeSlots;
  }
  
  pendingMeetings.set(pendingId, pending);
  
  return { 
    success: true,
    hasConflict: pending.hasConflict,
    timeSlots: pending.timeSlots.map(slot => ({
      startTime: slot.startTime.toISOString(),
      endTime: slot.endTime.toISOString(),
      isFree: slot.isFree,
    })),
  };
});

// Update a created meeting in Google Calendar
ipcMain.handle('update-created-meeting', async (_event, eventId: string, updates: {
  title?: string;
  participants?: string[];
  startTime?: string;
  duration?: number;
}) => {
  if (!contactService) {
    throw new Error('Contact service not initialized');
  }
  
  try {
    // Use Google Calendar to update
    if (!calendarService) {
      throw new Error('Calendar service not initialized');
    }
    
    // Get the existing event
    const existingEvent = await calendarService.getEvent(eventId);
    if (!existingEvent) {
      throw new Error('Event not found');
    }
    
    // Prepare updates
    const eventUpdates: any = {};
    
    if (updates.title !== undefined) {
      eventUpdates.summary = updates.title;
    }
    
    if (updates.participants !== undefined) {
      // Convert names to emails
      const emails = contactService.getEmails(updates.participants);
      eventUpdates.attendees = emails.map(email => ({ email }));
    }
    
    if (updates.startTime !== undefined) {
      const newStartTime = new Date(updates.startTime);
      const duration = updates.duration || 30;
      const newEndTime = new Date(newStartTime.getTime() + duration * 60000);
      
      eventUpdates.start = {
        dateTime: newStartTime.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      eventUpdates.end = {
        dateTime: newEndTime.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    }
    
    // Update the event
    const updatedEvent = await calendarService.updateEvent(eventId, eventUpdates);
    
    console.log('✅ Updated meeting in Google Calendar:', updatedEvent.id);
    
    return { 
      success: true,
      event: updatedEvent,
    };
  } catch (error) {
    console.error('Failed to update created meeting:', error);
    throw error;
  }
});

ipcMain.handle('check-google-auth-status', () => {
  return calendarService?.isAuthenticated() || false;
});

ipcMain.handle('authenticate-google', async () => {
  if (!calendarService) {
    throw new Error('Google Calendar service not initialized. Please configure your Google Client ID and Secret in Settings first.');
  }
  
  try {
    await calendarService.authenticate();
    return { success: true };
  } catch (error) {
    console.error('Google authentication failed:', error);
    throw error;
  }
});

ipcMain.handle('toggle-window-expansion', () => {
  toggleWindowExpansion();
  return { expanded: isExpanded };
});

ipcMain.handle('get-window-state', () => {
  return { expanded: isExpanded };
});

ipcMain.handle('set-window-width', (_event, width: number) => {
  if (!mainWindow) return;
  
  const currentBounds = mainWindow.getBounds();
  
  // Expand from window center to both sides
  const currentCenterX = currentBounds.x + currentBounds.width / 2;
  const newX = Math.round(currentCenterX - width / 2);
  
  mainWindow.setBounds({
    x: newX,
    y: currentBounds.y,
    width: width,
    height: currentBounds.height,
  }, true);
});
