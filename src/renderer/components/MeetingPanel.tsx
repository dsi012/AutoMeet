import { MeetingDetection } from '../App';
import { useState, useEffect } from 'react';

interface MeetingPanelProps {
  meetings: MeetingDetection[];
  onRemove?: (meetingId: string) => void;
  onTimeChange?: (meetingId: string, newTime: string) => void;
  onConfirm?: (meetingId: string) => void;
  autoConfirm?: boolean;
  onAutoConfirmChange?: (enabled: boolean) => void;
  onMeetingUpdate?: (meetingId: string, updates: {
    title?: string;
    participants?: string[];
    suggestedTime?: string;
  }) => void;
}

export default function MeetingPanel({ meetings, onRemove, onTimeChange, onConfirm, autoConfirm, onAutoConfirmChange, onMeetingUpdate }: MeetingPanelProps) {
  const [contacts, setContacts] = useState<Array<{ name: string; email: string }>>([]);
  const [editingMeeting, setEditingMeeting] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{
    title: string;
    participants: string[];
    date: string;
    time: string;
  }>({ title: '', participants: [], date: '', time: '' });

  // Load contacts on mount
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getContacts().then(setContacts);
    }
  }, []);

  // Helper function to convert email to name
  const emailToName = (emailOrName: string): string => {
    // If it's already a name (doesn't contain @), return as is
    if (!emailOrName.includes('@')) {
      return emailOrName;
    }
    // Look up the email in contacts
    const contact = contacts.find(c => c.email === emailOrName);
    return contact ? contact.name : emailOrName;
  };

  // Helper function to display participants (convert emails to names)
  const formatParticipants = (participants: string[]): string => {
    return participants.map(p => emailToName(p)).join(', ');
  };
  // Format meeting time in a more friendly format
  const formatMeetingTime = (timeString: string) => {
    try {
      const date = new Date(timeString);
      const now = new Date();
      
      // Create today and tomorrow dates (only compare year/month/day, ignore time)
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const meetingDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      
      const isToday = meetingDate.getTime() === today.getTime();
      const isTomorrow = meetingDate.getTime() === tomorrow.getTime();
      
      const timeStr = date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      
      if (isToday) {
        return `Today at ${timeStr}`;
      } else if (isTomorrow) {
        return `Tomorrow at ${timeStr}`;
      } else {
        const dateStr = date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
        return `${dateStr} at ${timeStr}`;
      }
    } catch (e) {
      return timeString;
    }
  };

  // Format time options
  const formatSlotTime = (timeString: string) => {
    try {
      const date = new Date(timeString);
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch (e) {
      return timeString;
    }
  };

  const getStatusColor = (status: MeetingDetection['status']) => {
    switch (status) {
      case 'detected':
        return 'bg-green-500 text-white';
      case 'creating':
        return 'bg-blue-100 text-blue-800';
      case 'created':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'conflict':
        return 'bg-red-500 text-white';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: MeetingDetection['status']) => {
    switch (status) {
      case 'detected':
        return 'Scheduled';
      case 'creating':
        return 'Creating...';
      case 'created':
        return 'Created';
      case 'failed':
        return 'Failed';
      case 'pending':
        return 'Pending';
      case 'conflict':
        return 'Conflict';
      default:
        return 'Unknown';
    }
  };

  // Whether to show time selector
  const needsTimeSelector = (status: MeetingDetection['status']) => {
    return status === 'pending' || status === 'conflict';
  };

  // Calculate number of scheduled meetings
  const scheduledCount = meetings.filter(
    m => m.status === 'detected' || m.status === 'created'
  ).length;

  // Start editing a meeting
  const startEditing = (meeting: MeetingDetection) => {
    const dateTime = meeting.suggestedTime ? new Date(meeting.suggestedTime) : new Date();
    const date = dateTime.toISOString().split('T')[0];
    const time = dateTime.toTimeString().slice(0, 5);
    
    // Convert emails to names for editing
    const participantNames = (meeting.participants || []).map(p => emailToName(p));
    
    setEditingMeeting(meeting.id);
    setEditValues({
      title: meeting.title || '',
      participants: participantNames,
      date,
      time,
    });
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingMeeting(null);
  };

  // Save edits
  const saveEdits = (meetingId: string) => {
    if (!onMeetingUpdate) return;
    
    const updates: any = {
      title: editValues.title,
      participants: editValues.participants,
    };
    
    // Combine date and time
    if (editValues.date && editValues.time) {
      const newDateTime = new Date(`${editValues.date}T${editValues.time}`);
      updates.suggestedTime = newDateTime.toISOString();
    }
    
    onMeetingUpdate(meetingId, updates);
    setEditingMeeting(null);
  };

  // Toggle participant selection
  const toggleParticipant = (name: string) => {
    setEditValues(prev => ({
      ...prev,
      participants: prev.participants.includes(name)
        ? prev.participants.filter(p => p !== name)
        : [...prev.participants, name],
    }));
  };

  return (
    <div className="h-full flex flex-col pl-4 pr-3 py-4">
      <div className="flex items-center justify-between mb-3 h-5">
        <h3 className="text-sm font-medium text-gray-200">
          Meetings
          {scheduledCount > 0 && (
            <span className="ml-2 text-xs text-gray-400 font-normal">
              ({scheduledCount})
            </span>
          )}
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto rounded-lg border border-gray-200/30 flex flex-col">
        <div className="flex-1 p-4 space-y-3 overflow-y-auto">
          {meetings.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-200">
              <svg className="w-12 h-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm text-gray-200">No meetings yet</p>
            </div>
          ) : (
            meetings.slice().reverse().map((meeting) => (
            <div
              key={meeting.id}
              className={`relative border border-gray-200/30 rounded-lg p-3 hover:border-gray-200/50 transition-colors ${
                meeting.status === 'detected' || meeting.status === 'created' 
                  ? 'bg-gray-800/30' 
                  : meeting.status === 'conflict'
                  ? 'bg-red-900/20 border-red-500/50'
                  : ''
              }`}
            >
              {/* Top right button area */}
              <div className="absolute top-2 right-2 flex items-center gap-1">
                {/* Edit button for pending and created meetings */}
                {(needsTimeSelector(meeting.status) || meeting.status === 'created') && editingMeeting !== meeting.id && (
                  <button
                    onClick={() => startEditing(meeting)}
                    className="p-1 text-gray-400 hover:text-blue-400 hover:bg-gray-700/50 rounded transition-colors"
                    title="Edit meeting"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}
                {/* Close button */}
                {onRemove && (
                  <button
                    onClick={() => onRemove(meeting.id)}
                    className="p-1 text-gray-400 hover:text-red-400 hover:bg-gray-700/50 rounded transition-colors"
                    title="Cancel meeting"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              
              <div className="flex items-start justify-between mb-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusColor(meeting.status)}`}>
                  {getStatusText(meeting.status)}
                </span>
              </div>

              {/* Title - editable for pending meetings */}
              {editingMeeting === meeting.id ? (
                <input
                  type="text"
                  value={editValues.title}
                  onChange={(e) => setEditValues(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full font-medium text-gray-200 mb-2 text-sm bg-gray-700/80 rounded px-2 py-1 border border-gray-600 focus:border-blue-500 focus:outline-none"
                  placeholder="Meeting title"
                />
              ) : meeting.title && (
                <h4 className="font-medium text-gray-200 mb-2 text-sm">
                  {meeting.title}
                </h4>
              )}

              <div className="space-y-1.5 text-xs">
                {/* Date and Time - editable for pending meetings when editing */}
                {editingMeeting === meeting.id ? (
                  <>
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <input
                        type="date"
                        value={editValues.date}
                        onChange={(e) => setEditValues(prev => ({ ...prev, date: e.target.value }))}
                        className="flex-1 bg-gray-700/80 text-gray-200 rounded px-2 py-1 text-xs border border-gray-600 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <input
                        type="time"
                        value={editValues.time}
                        onChange={(e) => setEditValues(prev => ({ ...prev, time: e.target.value }))}
                        className="flex-1 bg-gray-700/80 text-gray-200 rounded px-2 py-1 text-xs border border-gray-600 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    {/* Time display/selection - conflict status allows direct time selection, pending status only displays */}
                    {meeting.status === 'conflict' && meeting.timeSlots && meeting.timeSlots.length > 0 ? (
                      <div className="flex items-start">
                        <svg className="w-3.5 h-3.5 text-blue-400 mr-1.5 mt-1.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <select
                          value={meeting.selectedTime || meeting.suggestedTime || ''}
                          onChange={(e) => onTimeChange?.(meeting.id, e.target.value)}
                          className="flex-1 bg-gray-700/80 text-gray-200 rounded px-2 py-1 text-xs border border-gray-600 focus:border-blue-500 focus:outline-none"
                        >
                          {meeting.timeSlots.map((slot) => (
                            <option 
                              key={slot.startTime} 
                              value={slot.startTime}
                              className={slot.isFree ? 'text-green-400' : 'text-red-400'}
                            >
                              {formatSlotTime(slot.startTime)} {slot.isFree ? '✓' : '⚠️ Busy'}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : meeting.suggestedTime && (
                      <div className="flex items-start">
                        <svg className="w-3.5 h-3.5 text-blue-400 mr-1.5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <p className="text-gray-200 font-medium">{formatMeetingTime(meeting.suggestedTime)}</p>
                      </div>
                    )}
                  </>
                )}

                {/* Participants - editable for pending meetings when editing */}
                {editingMeeting === meeting.id ? (
                  <div className="space-y-1">
                    <div className="flex items-center">
                      <svg className="w-3.5 h-3.5 text-gray-400 mr-1.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                      <span className="text-gray-400 text-xs">Participants:</span>
                    </div>
                    <div className="max-h-32 overflow-y-auto bg-gray-700/50 rounded p-2 space-y-1">
                      {contacts.map((contact) => (
                        <label key={contact.email} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-600/50 rounded p-1">
                          <input
                            type="checkbox"
                            checked={editValues.participants.includes(contact.name)}
                            onChange={() => toggleParticipant(contact.name)}
                            className="rounded bg-gray-600 border-gray-500 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 focus:ring-1"
                          />
                          <span className="text-gray-200 text-xs">{contact.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : meeting.participants.length > 0 && (
                  <div className="flex items-start">
                    <svg className="w-3.5 h-3.5 text-gray-400 mr-1.5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    <p className="text-gray-200 flex-1">
                      {formatParticipants(meeting.participants)}
                    </p>
                  </div>
                )}
              </div>

              {/* Save/Cancel buttons when editing, Confirm button or View in Calendar otherwise */}
              {editingMeeting === meeting.id ? (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={cancelEditing}
                    className="flex-1 text-center px-3 py-1.5 bg-gray-600 text-white rounded hover:bg-gray-500 transition-colors text-xs font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => saveEdits(meeting.id)}
                    className="flex-1 text-center px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors text-xs font-medium"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <>
                  {/* Confirm button for pending/conflict status */}
                  {needsTimeSelector(meeting.status) && onConfirm && (
                    <button
                      onClick={() => onConfirm(meeting.id)}
                      className={`mt-2 block w-full text-center px-3 py-1.5 rounded transition-colors text-xs font-medium ${
                        meeting.status === 'conflict'
                          ? 'bg-orange-600 text-white hover:bg-orange-500'
                          : 'bg-green-600 text-white hover:bg-green-500'
                      }`}
                    >
                      {meeting.status === 'conflict' ? 'Confirm Anyway' : 'Confirm'}
                    </button>
                  )}

                  {/* View in Calendar button - created status */}
                  {meeting.status === 'created' && meeting.eventLink && (
                    <a
                      href={meeting.eventLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 block w-full text-center px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors text-xs font-medium"
                    >
                      View in Calendar
                    </a>
                  )}
                </>
              )}

              {/* Creating status display */}
              {meeting.status === 'creating' && (
                <div className="mt-2 flex items-center justify-center text-xs text-gray-400">
                  <svg className="animate-spin w-3.5 h-3.5 mr-1.5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creating meeting...
                </div>
              )}
            </div>
          ))
        )}
        </div>

        {/* Auto-confirm toggle at bottom - iOS style */}
        {onAutoConfirmChange && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-200/30 bg-gray-800/20">
            <span className="text-xs text-gray-400">Auto-confirm meetings</span>
            <button
              onClick={() => onAutoConfirmChange(!autoConfirm)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                autoConfirm ? 'bg-blue-500' : 'bg-gray-600'
              }`}
              title={autoConfirm ? 'Auto-confirm enabled' : 'Auto-confirm disabled'}
              role="switch"
              aria-checked={autoConfirm}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${
                  autoConfirm ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
