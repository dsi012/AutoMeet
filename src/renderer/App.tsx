import { useState, useEffect, useRef } from 'react';
import TranscriptPanel from './components/TranscriptPanel';
import MeetingPanel from './components/MeetingPanel';
import SettingsPanel from './components/SettingsPanel';
import { useAudioCapture } from './hooks/useAudioCapture';

export interface TranscriptItem {
  id: string;
  text: string;
  timestamp: Date;
  isFinal: boolean;
}

export interface TimeSlot {
  startTime: string;
  endTime: string;
  isFree: boolean;
}

export interface MeetingDetection {
  id: string;
  pendingId?: string;
  participants: string[];
  title?: string;
  suggestedTime?: string;
  selectedTime?: string;
  duration?: number;
  timestamp: Date;
  status: 'detected' | 'creating' | 'created' | 'failed' | 'pending' | 'conflict';
  eventLink?: string;
  googleEventId?: string;
  timeSlots?: TimeSlot[];
}

function App() {
  const [isListening, setIsListening] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);  // AI is analyzing transcription content
  const [micPermission, setMicPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [meetings, setMeetings] = useState<MeetingDetection[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [autoConfirm, setAutoConfirm] = useState(true); // Auto-confirm meetings without conflicts
  const autoConfirmRef = useRef(autoConfirm); // Keep reference to latest value
  
  // Audio capture hook for microphone input
  console.log('🔧 Initializing useAudioCapture hook...');
  const { startCapture, stopCapture } = useAudioCapture({
    sampleRate: 48000, // ElevenLabs supports 8kHz-48kHz, using 48kHz for better quality
    channelCount: 1,   // Mono audio
  });
  console.log('✅ useAudioCapture hook initialized, functions:', { startCapture: typeof startCapture, stopCapture: typeof stopCapture });

  // Keep ref in sync with autoConfirm state
  useEffect(() => {
    autoConfirmRef.current = autoConfirm;
  }, [autoConfirm]);

  useEffect(() => {
    // Check microphone permission on mount
    checkMicrophonePermission();
    
    // Check window state
    checkWindowState();
    
    // Set up IPC listeners
    if (window.electronAPI) {
      const unsubscribeTranscription = window.electronAPI.onTranscriptionData((data) => {
        setTranscripts(prev => {
          const lastItem = prev[prev.length - 1];
          const timestamp = new Date(data.timestamp);
          
          // Helper function: normalize text for comparison (remove punctuation)
          const normalizeText = (text: string) => 
            text.replace(/[^\w\s\u4e00-\u9fff]/g, '').toLowerCase();

          if (data.isFinal) {
            // If the last item is partial, always update it to final
            // final is the final confirmation/correction of partial, should replace even if text changes
            if (lastItem && !lastItem.isFinal) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...lastItem,
                text: data.text,
                timestamp,
                isFinal: true,
              };
              return updated;
            }

            // Check if this is a duplicate final (exact match or same after normalization)
            const duplicateFinal = prev.some(item => {
              if (!item.isFinal) return false;
              if (item.text === data.text) return true;
              // Also check if normalized text is the same
              return normalizeText(item.text) === normalizeText(data.text);
            });
            if (duplicateFinal) {
              console.log('Ignoring duplicate final transcript:', data.text);
              return prev;
            }

            return [
              ...prev,
              {
                id: Date.now().toString() + Math.random(),
                text: data.text,
                timestamp,
                isFinal: true,
              },
            ];
          }

          if (lastItem && !lastItem.isFinal) {
            if (lastItem.text === data.text) {
              return prev;
            }

            const updated = [...prev];
            updated[updated.length - 1] = {
              ...lastItem,
              text: data.text,
              timestamp,
            };
            return updated;
          }

          return [
            ...prev,
            {
              id: Date.now().toString() + Math.random(),
              text: data.text,
              timestamp,
              isFinal: false,
            },
          ];
        });
      });

      const unsubscribeMeetingDetected = window.electronAPI.onMeetingDetected((data) => {
        const newMeeting: MeetingDetection = {
          id: Date.now().toString() + Math.random(),
          participants: data.participants || [],
          title: data.title,
          suggestedTime: data.suggestedTime,
          duration: data.duration || 30,
          timestamp: new Date(),
          status: 'detected',
        };
        
        setMeetings(prev => [...prev, newMeeting]);
      });

      const unsubscribeMeetingCreated = window.electronAPI.onMeetingCreated((data) => {
        setMeetings(prev => {
          // Check if meeting already exists (by meetingId or pendingId)
          const existingIndex = prev.findIndex(m => m.id === data.meetingId || m.pendingId === data.meetingId);
          if (existingIndex >= 0) {
            // Update existing meeting
            const updated = [...prev];
            updated[existingIndex] = { 
              ...updated[existingIndex], 
              status: 'created', 
              eventLink: data.eventLink,
              googleEventId: data.event?.id,
              suggestedTime: data.event?.start?.dateTime,
              timeSlots: undefined, // Clear time slots after creation
              pendingId: undefined, // Clear pending ID after creation
            };
            return updated;
          }
          
          // Add new meeting (for end-of-recording batch creation)
          const newMeeting: MeetingDetection = {
            id: data.meetingId,
            participants: data.event?.attendees?.map((a: any) => a.email) || [],
            title: data.event?.summary || 'Meeting',
            suggestedTime: data.event?.start?.dateTime,
            duration: 30,
            timestamp: new Date(),
            status: 'created',
            eventLink: data.eventLink,
            googleEventId: data.event?.id,
          };
          return [...prev, newMeeting];
        });
      });

      const unsubscribeMeetingPending = window.electronAPI.onMeetingPending(async (data) => {
        const newMeeting: MeetingDetection = {
          id: Date.now().toString() + Math.random(),
          pendingId: data.pendingId,
          participants: data.participants || [],
          title: data.title,
          suggestedTime: data.suggestedTime,
          selectedTime: data.suggestedTime,
          duration: data.duration || 30,
          timestamp: new Date(),
          status: data.hasConflict ? 'conflict' : 'pending',
          timeSlots: data.timeSlots,
        };
        
        setMeetings(prev => [...prev, newMeeting]);

        // Auto-confirm if enabled and no conflict
        if (autoConfirmRef.current && !data.hasConflict && data.pendingId && data.suggestedTime) {
          console.log('🤖 Auto-confirming meeting:', data.title);
          // Wait a bit for state to update
          setTimeout(async () => {
            try {
              setMeetings(prev => prev.map(m => 
                m.pendingId === data.pendingId ? { ...m, status: 'creating' } : m
              ));
              await window.electronAPI.confirmMeeting(data.pendingId, data.suggestedTime);
            } catch (error) {
              console.error('Auto-confirm failed:', error);
              setMeetings(prev => prev.map(m => 
                m.pendingId === data.pendingId ? { ...m, status: 'failed' } : m
              ));
            }
          }, 100);
        }
      });

      const unsubscribeTranscriptionError = window.electronAPI.onTranscriptionError((data) => {
        console.error('Transcription error:', data.error);
        // Stop listening state
        setIsListening(false);
        
        // Show error with retry option
        const retry = confirm(
          `Transcription connection failed:\n\n${data.error}\n\nWould you like to retry?`
        );
        
        if (retry) {
          // Retry by toggling listening back on
          setTimeout(() => {
            toggleListening();
          }, 500);
        }
      });

      const unsubscribeTranscriptionStatus = window.electronAPI.onTranscriptionStatus((data) => {
        console.log('Transcription status:', data);
        
        // Only show alert if there's a problem
        if (!data.connected && data.error && isListening) {
          // Connection lost unexpectedly
          setIsListening(false);
          
          const retry = confirm(
            `Connection lost:\n\n${data.error}\n\nWould you like to reconnect?`
          );
          
          if (retry) {
            setTimeout(() => {
              toggleListening();
            }, 500);
          }
        } else if (data.connected && data.error) {
          // Connection has warnings (e.g., no transcripts being received)
          console.warn('⚠️ Connection warning:', data.error);
          // Don't interrupt user for warnings, just log them
        }
      });

      const unsubscribeAnalyzingMeetings = window.electronAPI.onAnalyzingMeetings((data) => {
        console.log('Analyzing meetings status:', data);
        if (data.status === 'started') {
          setIsAnalyzing(true);
        } else {
          // 'complete' or 'error'
          setIsAnalyzing(false);
        }
      });

      // Cleanup listeners on unmount
      return () => {
        unsubscribeTranscription();
        unsubscribeMeetingDetected();
        unsubscribeMeetingCreated();
        unsubscribeMeetingPending();
        unsubscribeTranscriptionError();
        unsubscribeTranscriptionStatus();
        unsubscribeAnalyzingMeetings();
      };
    }
  }, []); // Empty deps - this should only run once on mount

  const checkMicrophonePermission = async () => {
    if (window.electronAPI) {
      const status = await window.electronAPI.getMicrophoneStatus();
      setMicPermission(status as any);
    }
  };

  const checkWindowState = async () => {
    if (window.electronAPI) {
      const state = await window.electronAPI.getWindowState();
      setIsExpanded(state.expanded);
    }
  };

  const toggleExpansion = async () => {
    if (window.electronAPI) {
      const result = await window.electronAPI.toggleWindowExpansion();
      setIsExpanded(result.expanded);
    }
  };

  const requestMicrophonePermission = async () => {
    if (window.electronAPI) {
      const granted = await window.electronAPI.requestMicrophonePermission();
      setMicPermission(granted ? 'granted' : 'denied');
      return granted;
    }
    return false;
  };

  const toggleListening = async () => {
    if (!isListening) {
      // Check permission first
      if (micPermission !== 'granted') {
        const granted = await requestMicrophonePermission();
        if (!granted) {
          alert('Microphone permission is required to use this app.');
          return;
        }
      }

      // Start listening - first start WebSocket connection, then audio capture
      if (window.electronAPI) {
        try {
          // Wait for WebSocket connection to be fully established
          console.log('🎤 Starting transcription service...');
          console.log('🔍 electronAPI available:', !!window.electronAPI);
          console.log('🔍 startTranscription available:', typeof window.electronAPI.startTranscription);
          console.log('🔍 sendAudioData available:', typeof window.electronAPI.sendAudioData);
          
          await window.electronAPI.startTranscription();
          console.log('✅ Transcription service connected');
          
          // Start capturing audio from microphone
          const captureStarted = await startCapture();
          console.log('🎤 Audio capture result:', captureStarted);
          
          if (!captureStarted) {
            window.electronAPI.stopTranscription();
            alert('Failed to start audio capture. Please check microphone permissions.');
            return;
          }
          
          console.log('✅ Everything started successfully!');
          setIsListening(true);
        } catch (error) {
          console.error('❌ Error starting listening:', error);
          alert('Failed to start listening: ' + (error as Error).message);
        }
      } else {
        console.error('❌ electronAPI not available!');
      }
    } else {
      // Stop listening - stop audio capture first, then WebSocket
      stopCapture();
      
      if (window.electronAPI) {
        window.electronAPI.stopTranscription();
        setIsListening(false);
      }
    }
  };

  const removeMeeting = async (meetingId: string) => {
    const meeting = meetings.find(m => m.id === meetingId);
    
    // Cancel pending meeting if applicable
    if (meeting?.pendingId && window.electronAPI) {
      try {
        await window.electronAPI.cancelPendingMeeting(meeting.pendingId);
      } catch (error) {
        console.error('Failed to cancel pending meeting:', error);
      }
    }
    
    // Delete from Google Calendar if we have the event ID
    if (meeting?.googleEventId && window.electronAPI) {
      try {
        await window.electronAPI.deleteCalendarEvent(meeting.googleEventId);
        console.log('✅ Deleted calendar event:', meeting.googleEventId);
      } catch (error) {
        console.error('Failed to delete calendar event:', error);
      }
    }
    
    // Remove from local state
    setMeetings(prev => prev.filter(m => m.id !== meetingId));
  };

  const updateMeetingTime = (meetingId: string, newTime: string) => {
    setMeetings(prev => prev.map(m => 
      m.id === meetingId 
        ? { ...m, selectedTime: newTime, status: m.timeSlots?.find(s => s.startTime === newTime)?.isFree ? 'pending' : 'conflict' }
        : m
    ));
  };

  const updateMeeting = async (meetingId: string, updates: {
    title?: string;
    participants?: string[];
    suggestedTime?: string;
  }) => {
    const meeting = meetings.find(m => m.id === meetingId);
    if (!meeting || !window.electronAPI) return;
    
    try {
      // Handle created meetings (check status first, not pendingId)
      if (meeting.status === 'created' && meeting.googleEventId) {
        const result = await window.electronAPI.updateCreatedMeeting(meeting.googleEventId, {
          title: updates.title,
          participants: updates.participants,
          startTime: updates.suggestedTime,
          duration: meeting.duration || 30,
        });
        
        // Update local state with the updated event data
        setMeetings(prev => prev.map(m => 
          m.id === meetingId 
            ? { 
                ...m, 
                title: result.event.summary || m.title,
                participants: result.event.attendees?.map((a: any) => a.email) || m.participants,
                suggestedTime: result.event.start?.dateTime || m.suggestedTime,
              }
            : m
        ));
      }
      // Handle pending/conflict meetings
      else if ((meeting.status === 'pending' || meeting.status === 'conflict') && meeting.pendingId) {
        const result = await window.electronAPI.updatePendingMeeting(meeting.pendingId, updates);
        
        // Update local state
        setMeetings(prev => prev.map(m => 
          m.id === meetingId 
            ? { 
                ...m, 
                ...updates,
                status: result.hasConflict ? 'conflict' : 'pending',
                timeSlots: result.timeSlots,
                selectedTime: updates.suggestedTime || m.selectedTime,
              }
            : m
        ));
      }
    } catch (error) {
      console.error('Failed to update meeting:', error);
      alert('Failed to update meeting: ' + (error as Error).message);
    }
  };

  const confirmMeeting = async (meetingId: string) => {
    const meeting = meetings.find(m => m.id === meetingId);
    if (!meeting?.pendingId || !meeting?.selectedTime || !window.electronAPI) return;
    
    // Update status to creating
    setMeetings(prev => prev.map(m => 
      m.id === meetingId ? { ...m, status: 'creating' } : m
    ));
    
    try {
      await window.electronAPI.confirmMeeting(meeting.pendingId, meeting.selectedTime);
      // The meeting-created event will update the status to 'created'
    } catch (error) {
      console.error('Failed to confirm meeting:', error);
      setMeetings(prev => prev.map(m => 
        m.id === meetingId ? { ...m, status: 'failed' } : m
      ));
    }
  };

  return (
    <div className="flex flex-col h-screen bg-transparent items-center">
      <div className="w-full h-full flex flex-col">
      {/* Top draggable area - semi-transparent dark gray */}
      <div 
        className={`h-7 bg-gray-800/60 backdrop-blur-lg flex items-center justify-between px-3 transition-all relative draggable ${
          isExpanded ? '' : 'rounded-b-lg'
        }`}
      >
        {/* Left: App name */}
        <div className="flex items-center space-x-2 text-gray-100">
          <span className="text-xs font-medium">Scheduler</span>
        </div>

        {/* Center: Microphone button */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center space-x-2 no-drag">
          {/* Microphone button */}
          <button
            onClick={async () => {
              if (micPermission !== 'granted') {
                const granted = await requestMicrophonePermission();
                if (!granted) {
                  alert('Microphone permission is required.');
                  return;
                }
              }
              toggleListening();
            }}
            disabled={micPermission === 'denied'}
            className="relative p-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            title={isAnalyzing ? 'AI Analyzing...' : (isListening ? 'Stop Listening' : 'Start Listening')}
          >
            {/* Analyzing: show loading ring */}
            {isAnalyzing ? (
              <div className="w-4 h-4 relative">
                <div className="absolute inset-0 border-2 border-red-500/30 rounded-full"></div>
                <div className="absolute inset-0 border-2 border-transparent border-t-red-500 rounded-full animate-spin"></div>
              </div>
            ) : (
              <>
                <svg 
                  className={`w-4 h-4 transition-colors ${
                    isListening ? 'text-red-500 animate-mic-pulse' : 'text-gray-200'
                  }`}
                  fill="currentColor" 
                  viewBox="0 0 20 20"
                >
                  <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                </svg>
                {/* Slash - shown when not recording */}
                {!isListening && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-5 h-0.5 bg-gray-200 rotate-45"></div>
                  </div>
                )}
              </>
            )}
          </button>
        </div>
        
        {/* Right: Dropdown arrow */}
        <div 
          className="cursor-pointer hover:text-gray-50 text-gray-200 no-drag"
          onClick={toggleExpansion}
        >
          <svg 
            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Main content area - using transition animation */}
      <div 
        className={`flex items-stretch overflow-hidden bg-gray-800/60 backdrop-blur-lg rounded-b-lg transition-all duration-300 ease-in-out ${
          isExpanded ? 'flex-1 opacity-100' : 'h-0 opacity-0'
        }`}
      >
        {/* Left: Meeting list */}
        <div className="flex-1 h-full relative min-w-0">
          {/* Button group - top right corner of meetings panel */}
          <div className="absolute top-2 right-2 z-10 flex items-center space-x-1">
            {/* Logs button */}
            <button
              onClick={async () => {
                try {
                  await window.electronAPI.openLogDirectory();
                } catch (error) {
                  console.error('Failed to open log directory:', error);
                }
              }}
              className="p-1.5 bg-gray-700/80 hover:bg-gray-600/80 rounded text-gray-300 hover:text-white transition-colors"
              title="Open log files"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
            
            {/* Settings button */}
            <button
              onClick={() => {
                const newShowSettings = !showSettings;
                setShowSettings(newShowSettings);
                // If opening settings, close transcript
                if (newShowSettings) {
                  setShowTranscript(false);
                }
                // Adjust window width
                if (window.electronAPI) {
                  const newWidth = newShowSettings ? 800 : 300;
                  window.electronAPI.setWindowWidth(newWidth);
                }
              }}
              className={`p-1.5 rounded transition-colors ${
                showSettings 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-gray-700/80 hover:bg-gray-600/80 text-gray-300 hover:text-white'
              }`}
              title={showSettings ? 'Hide Settings' : 'Show Settings'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            
            {/* Toggle Transcript button */}
            <button
              onClick={() => {
                const newShowTranscript = !showTranscript;
                setShowTranscript(newShowTranscript);
                // If opening transcript, close settings
                if (newShowTranscript) {
                  setShowSettings(false);
                }
                // Adjust window width
                if (window.electronAPI) {
                  const newWidth = newShowTranscript ? 560 : 300;
                  window.electronAPI.setWindowWidth(newWidth);
                }
              }}
              className={`p-1.5 rounded transition-colors ${
                showTranscript 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-gray-700/80 hover:bg-gray-600/80 text-gray-300 hover:text-white'
              }`}
              title={showTranscript ? 'Hide Transcript' : 'Show Transcript'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
              </svg>
            </button>
          </div>
          <MeetingPanel 
                meetings={meetings} 
                onRemove={removeMeeting}
                onTimeChange={updateMeetingTime}
                onConfirm={confirmMeeting}
                onMeetingUpdate={updateMeeting}
                autoConfirm={autoConfirm}
                onAutoConfirmChange={setAutoConfirm}
              />
        </div>
        
        {/* Right: Transcript text or settings panel */}
        {showTranscript && (
          <div className="flex-1 h-full border-l border-gray-200/30 min-w-0">
            <TranscriptPanel transcripts={transcripts} />
          </div>
        )}
        
        {showSettings && (
          <div className="flex-1 h-full border-l border-gray-200/30 min-w-0">
            <SettingsPanel />
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

export default App;
