// Type definitions for the Electron API exposed via preload

export interface ElectronAPI {
  requestMicrophonePermission: () => Promise<boolean>;
  getMicrophoneStatus: () => Promise<string>;
  initializeServices: (settings: AppSettings) => Promise<{ success: boolean }>;
  openGoogleAuth: () => Promise<any>;
  getGoogleAuthToken: () => Promise<string | null>;
    checkGoogleAuthStatus: () => Promise<boolean>;
    authenticateGoogle: () => Promise<{ success: boolean }>;
  createCalendarEvent: (eventData: CalendarEventData) => Promise<any>;
  deleteCalendarEvent: (eventId: string) => Promise<{ success: boolean }>;
  confirmMeeting: (pendingId: string, selectedStartTime: string) => Promise<{ success: boolean }>;
  cancelPendingMeeting: (pendingId: string) => Promise<{ success: boolean }>;
  getContacts: () => Promise<Array<{ name: string; email: string }>>;
  updatePendingMeeting: (pendingId: string, updates: {
    title?: string;
    participants?: string[];
    suggestedTime?: string;
    duration?: number;
  }) => Promise<{ success: boolean; hasConflict: boolean; timeSlots: TimeSlot[] }>;
  updateCreatedMeeting: (googleEventId: string, updates: {
    title?: string;
    participants?: string[];
    startTime?: string;
    duration?: number;
  }) => Promise<{ success: boolean; event: any }>;
  startTranscription: () => void;
  stopTranscription: () => void;
  sendAudioData: (audioData: ArrayBuffer) => void;
  onTranscriptionData: (callback: (data: TranscriptionData) => void) => () => void;
  onMeetingDetected: (callback: (data: MeetingData) => void) => () => void;
  onMeetingCreated: (callback: (data: MeetingCreatedData) => void) => () => void;
  onMeetingPending: (callback: (data: MeetingPendingData) => void) => () => void;
  onTranscriptionError: (callback: (data: TranscriptionErrorData) => void) => () => void;
  onTranscriptionStatus: (callback: (data: TranscriptionStatusData) => void) => () => void;
  onAnalyzingMeetings: (callback: (data: AnalyzingMeetingsData) => void) => () => void;
  toggleWindowExpansion: () => Promise<{ expanded: boolean }>;
  getWindowState: () => Promise<{ expanded: boolean }>;
  setWindowWidth: (width: number) => Promise<void>;
  getLogInfo: () => Promise<{ logFilePath: string; logDirectory: string }>;
  openLogDirectory: () => Promise<{ success: boolean }>;
  getRecentLogs: (lines?: number) => Promise<string>;
  clearLogs: () => Promise<{ success: boolean }>;
  getBuiltInConfig: () => Promise<any>;
  saveSettings: (settings: AppSettings) => Promise<{ success: boolean }>;
  loadSettings: () => Promise<AppSettings | null>;
  uploadContactsCSV: (csvContent: string, fileName?: string) => Promise<{ success: boolean; contactCount: number; uploadTime: string; fileName: string; message: string }>;
  getContactsFiles: () => Promise<Array<{ fileName: string; contactCount: number; uploadTime: Date }>>;
  deleteContactsFile: (fileName: string) => Promise<{ success: boolean }>;
}

export interface AppSettings {
  elevenlabsApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  googleClientId: string;
  googleClientSecret: string;
}

export interface TranscriptionData {
  text: string;
  isFinal: boolean;
  timestamp: string;
}

export interface TranscriptionErrorData {
  error: string;
}

export interface TranscriptionStatusData {
  connected: boolean;
  error?: string;
  timestamp: string;
}

export interface MeetingData {
  participants: string[];
  topic?: string;
  suggestedTime?: string;
  duration?: number;
  confidence: number;
  title?: string;
  description?: string;
}

export interface MeetingCreatedData {
  meetingId: string;
  eventLink: string;
  event: any;
}

export interface TimeSlot {
  startTime: string;
  endTime: string;
  isFree: boolean;
}

export interface MeetingPendingData {
  pendingId: string;
  title: string;
  participants: string[];
  suggestedTime: string;
  duration: number;
  hasConflict: boolean;
  timeSlots: TimeSlot[];
}

export interface AnalyzingMeetingsData {
  status: 'started' | 'complete' | 'error';
  message?: string;
}

export interface CalendarEventData {
  summary: string;
  description?: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  attendees?: Array<{ email: string }>;
  conferenceData?: {
    createRequest: {
      requestId: string;
      conferenceSolutionKey: {
        type: string;
      };
    };
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

