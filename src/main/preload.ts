import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Microphone permissions
  requestMicrophonePermission: () => ipcRenderer.invoke('request-microphone-permission'),
  getMicrophoneStatus: () => ipcRenderer.invoke('get-microphone-status'),
  
  // Service initialization
  initializeServices: (settings: any) => ipcRenderer.invoke('initialize-services', settings),
  getBuiltInConfig: () => ipcRenderer.invoke('get-built-in-config'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  
  // Google Calendar
  openGoogleAuth: () => ipcRenderer.invoke('open-google-auth'),
  getGoogleAuthToken: () => ipcRenderer.invoke('get-google-auth-token'),
  checkGoogleAuthStatus: () => ipcRenderer.invoke('check-google-auth-status'),
  authenticateGoogle: () => ipcRenderer.invoke('authenticate-google'),
  createCalendarEvent: (eventData: any) => ipcRenderer.invoke('create-calendar-event', eventData),
  deleteCalendarEvent: (eventId: string) => ipcRenderer.invoke('delete-calendar-event', eventId),
  confirmMeeting: (pendingId: string, selectedStartTime: string) => ipcRenderer.invoke('confirm-meeting', pendingId, selectedStartTime),
  cancelPendingMeeting: (pendingId: string) => ipcRenderer.invoke('cancel-pending-meeting', pendingId),
  getContacts: () => ipcRenderer.invoke('get-contacts'),
  updatePendingMeeting: (pendingId: string, updates: any) => ipcRenderer.invoke('update-pending-meeting', pendingId, updates),
  updateCreatedMeeting: (googleEventId: string, updates: any) => ipcRenderer.invoke('update-created-meeting', googleEventId, updates),
  
  // Transcription control
  startTranscription: () => ipcRenderer.invoke('start-transcription'),
  stopTranscription: () => ipcRenderer.send('stop-transcription'),
  sendAudioData: (audioData: ArrayBuffer) => ipcRenderer.send('audio-data', audioData),
  
  // Event listeners
  onTranscriptionData: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('transcription-data', listener);
    return () => ipcRenderer.removeListener('transcription-data', listener);
  },
  onMeetingDetected: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('meeting-detected', listener);
    return () => ipcRenderer.removeListener('meeting-detected', listener);
  },
  onMeetingCreated: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('meeting-created', listener);
    return () => ipcRenderer.removeListener('meeting-created', listener);
  },
  onMeetingPending: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('meeting-pending', listener);
    return () => ipcRenderer.removeListener('meeting-pending', listener);
  },
  onTranscriptionError: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('transcription-error', listener);
    return () => ipcRenderer.removeListener('transcription-error', listener);
  },
  onTranscriptionStatus: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('transcription-status', listener);
    return () => ipcRenderer.removeListener('transcription-status', listener);
  },
  onAnalyzingMeetings: (callback: (data: { status: 'started' | 'complete' | 'error'; message?: string }) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('analyzing-meetings', listener);
    return () => ipcRenderer.removeListener('analyzing-meetings', listener);
  },
  
  // Window controls
  toggleWindowExpansion: () => ipcRenderer.invoke('toggle-window-expansion'),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  setWindowWidth: (width: number) => ipcRenderer.invoke('set-window-width', width),
  
  // Logging
  getLogInfo: () => ipcRenderer.invoke('get-log-info'),
  openLogDirectory: () => ipcRenderer.invoke('open-log-directory'),
  getRecentLogs: (lines?: number) => ipcRenderer.invoke('get-recent-logs', lines),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),
  
  // Upload CSV contacts file
  uploadContactsCSV: (csvContent: string, fileName?: string) => ipcRenderer.invoke('upload-contacts-csv', csvContent, fileName),
  getContactsFiles: () => ipcRenderer.invoke('get-contacts-files'),
  deleteContactsFile: (fileName: string) => ipcRenderer.invoke('delete-contacts-file', fileName),
});

// Type declaration for TypeScript
declare global {
  interface Window {
    electronAPI: {
      requestMicrophonePermission: () => Promise<boolean>;
      getMicrophoneStatus: () => Promise<string>;
      initializeServices: (settings: any) => Promise<{ success: boolean }>;
      getBuiltInConfig: () => Promise<any>;
      saveSettings: (settings: any) => Promise<{ success: boolean }>;
      loadSettings: () => Promise<any>;
      openGoogleAuth: () => Promise<any>;
      getGoogleAuthToken: () => Promise<string | null>;
      checkGoogleAuthStatus: () => Promise<boolean>;
      createCalendarEvent: (eventData: any) => Promise<any>;
      deleteCalendarEvent: (eventId: string) => Promise<{ success: boolean }>;
      confirmMeeting: (pendingId: string, selectedStartTime: string) => Promise<{ success: boolean }>;
      cancelPendingMeeting: (pendingId: string) => Promise<{ success: boolean }>;
      getContacts: () => Promise<Array<{ name: string; email: string }>>;
      updatePendingMeeting: (pendingId: string, updates: any) => Promise<{ success: boolean; hasConflict: boolean; timeSlots: any[] }>;
      updateCreatedMeeting: (googleEventId: string, updates: any) => Promise<{ success: boolean; event: any }>;
      startTranscription: () => Promise<{ success: boolean }>;
      stopTranscription: () => void;
      sendAudioData: (audioData: ArrayBuffer) => void;
      onTranscriptionData: (callback: (data: any) => void) => () => void;
      onMeetingDetected: (callback: (data: any) => void) => () => void;
      onMeetingCreated: (callback: (data: any) => void) => () => void;
      onMeetingPending: (callback: (data: any) => void) => () => void;
      onTranscriptionError: (callback: (data: any) => void) => () => void;
      onTranscriptionStatus: (callback: (data: any) => void) => () => void;
      onAnalyzingMeetings: (callback: (data: { status: 'started' | 'complete' | 'error'; message?: string }) => void) => () => void;
      toggleWindowExpansion: () => Promise<{ expanded: boolean }>;
      getWindowState: () => Promise<{ expanded: boolean }>;
      setWindowWidth: (width: number) => Promise<void>;
      getLogInfo: () => Promise<{ logFilePath: string; logDirectory: string }>;
      openLogDirectory: () => Promise<{ success: boolean }>;
      getRecentLogs: (lines?: number) => Promise<string>;
      clearLogs: () => Promise<{ success: boolean }>;
      uploadContactsCSV: (csvContent: string, fileName?: string) => Promise<{ success: boolean; contactCount: number; uploadTime: string; fileName: string; message: string }>;
      getContactsFiles: () => Promise<Array<{ fileName: string; contactCount: number; uploadTime: Date }>>;
      deleteContactsFile: (fileName: string) => Promise<{ success: boolean }>;
    };
  }
}
