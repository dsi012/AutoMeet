import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';
import { app, BrowserWindow } from 'electron';

export interface CalendarEvent {
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

export class CalendarService {
  private oauth2Client: OAuth2Client;
  private calendar: any;
  private tokenPath: string;

  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
    this.tokenPath = path.join(app.getPath('userData'), 'google-token.json');

    // Load saved token if exists
    this.loadToken();
  }

  private loadToken() {
    try {
      if (fs.existsSync(this.tokenPath)) {
        const token = JSON.parse(fs.readFileSync(this.tokenPath, 'utf-8'));
        this.oauth2Client.setCredentials(token);
      }
    } catch (error) {
      console.error('Error loading token:', error);
    }
  }

  private saveToken(token: any) {
    try {
      fs.writeFileSync(this.tokenPath, JSON.stringify(token));
    } catch (error) {
      console.error('Error saving token:', error);
    }
  }

  async authenticate(): Promise<void> {
    return new Promise((resolve, reject) => {
      const authUrl = this.oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events',
        ],
      });

      // Open auth window
      const authWindow = new BrowserWindow({
        width: 600,
        height: 800,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      authWindow.loadURL(authUrl);

      // Listen for redirect
      authWindow.webContents.on('will-redirect', async (event, url) => {
        if (url.startsWith('http://localhost')) {
          event.preventDefault();
          
          const urlParams = new URL(url).searchParams;
          const code = urlParams.get('code');

          if (code) {
            try {
              const { tokens } = await this.oauth2Client.getToken(code);
              this.oauth2Client.setCredentials(tokens);
              this.saveToken(tokens);
              authWindow.close();
              resolve();
            } catch (error) {
              authWindow.close();
              reject(error);
            }
          }
        }
      });

      authWindow.on('closed', () => {
        reject(new Error('Authentication window closed'));
      });
    });
  }

  async createEvent(eventData: CalendarEvent): Promise<any> {
    try {
      const insertParams: any = {
        calendarId: 'primary',
        requestBody: eventData,
      };

      // Only add conferenceDataVersion if conferenceData is present
      if (eventData.conferenceData) {
        insertParams.conferenceDataVersion = 1;
      }

      const response = await this.calendar.events.insert(insertParams);

      return response.data;
    } catch (error) {
      console.error('Error creating calendar event:', error);
      throw error;
    }
  }

  async getEvent(eventId: string): Promise<any> {
    try {
      const response = await this.calendar.events.get({
        calendarId: 'primary',
        eventId,
      });
      return response.data;
    } catch (error) {
      console.error('Error getting calendar event:', error);
      throw error;
    }
  }

  async updateEvent(eventId: string, eventData: Partial<CalendarEvent>): Promise<any> {
    try {
      const response = await this.calendar.events.patch({
        calendarId: 'primary',
        eventId,
        requestBody: eventData,
      });
      return response.data;
    } catch (error) {
      console.error('Error updating calendar event:', error);
      throw error;
    }
  }

  async deleteEvent(eventId: string): Promise<void> {
    try {
      await this.calendar.events.delete({
        calendarId: 'primary',
        eventId,
      });
      console.log('✅ Calendar event deleted:', eventId);
    } catch (error) {
      console.error('Error deleting calendar event:', error);
      throw error;
    }
  }

  async listRecentEvents(maxResults: number = 10): Promise<any[]> {
    try {
      const response = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: new Date().toISOString(),
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      });
      return response.data.items || [];
    } catch (error) {
      console.error('Error listing calendar events:', error);
      throw error;
    }
  }

  async findFreeSlots(
    attendees: string[],
    durationMinutes: number = 30,
    daysAhead: number = 7
  ): Promise<any[]> {
    try {
      const now = new Date();
      const timeMin = now.toISOString();
      const timeMax = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

      const response = await this.calendar.freebusy.query({
        requestBody: {
          timeMin,
          timeMax,
          items: attendees.map(email => ({ id: email })),
        },
      });

      // Process free/busy data to find available slots
      // This is a simplified version - you'd want more sophisticated logic
      return response.data.calendars || {};
    } catch (error) {
      console.error('Error finding free slots:', error);
      return [];
    }
  }

  /**
   * Find the next available time slot on a specific date or from now
   * @param targetDate - Optional specific date to search (will search that day only)
   * @param durationMinutes - Meeting duration in minutes
   * @returns The start time of the next available slot
   */
  async findNextAvailableSlot(
    targetDate?: Date,
    durationMinutes: number = 30
  ): Promise<Date> {
    try {
      const now = new Date();
      let searchStart: Date;
      let searchEnd: Date;

      if (targetDate && !isNaN(targetDate.getTime())) {
        // Search on the specific date (9 AM - 6 PM)
        searchStart = new Date(targetDate);
        searchStart.setHours(9, 0, 0, 0);
        
        // If target date is today and it's already past 9 AM, start from next hour
        if (searchStart < now) {
          searchStart = new Date(now);
          searchStart.setMinutes(0, 0, 0);
          searchStart.setHours(searchStart.getHours() + 1);
        }
        
        searchEnd = new Date(targetDate);
        searchEnd.setHours(18, 0, 0, 0);
      } else {
        // Search from now for the next 7 days
        searchStart = new Date(now);
        searchStart.setMinutes(0, 0, 0);
        searchStart.setHours(searchStart.getHours() + 1);
        searchEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      }

      console.log(`🔍 Searching for free slot from ${searchStart.toLocaleString()} to ${searchEnd.toLocaleString()}`);

      // Get busy times from calendar
      const response = await this.calendar.freebusy.query({
        requestBody: {
          timeMin: searchStart.toISOString(),
          timeMax: searchEnd.toISOString(),
          items: [{ id: 'primary' }],
        },
      });

      const busyTimes = response.data.calendars?.primary?.busy || [];
      console.log(`📅 Found ${busyTimes.length} busy periods`);

      // Find first available slot
      let currentSlot = new Date(searchStart);
      const slotDuration = durationMinutes * 60 * 1000;

      while (currentSlot < searchEnd) {
        // Skip non-working hours (before 9 AM or after 6 PM)
        const hour = currentSlot.getHours();
        if (hour < 9) {
          currentSlot.setHours(9, 0, 0, 0);
          continue;
        }
        if (hour >= 18) {
          // Move to next day 9 AM
          currentSlot.setDate(currentSlot.getDate() + 1);
          currentSlot.setHours(9, 0, 0, 0);
          continue;
        }

        // Skip weekends
        const dayOfWeek = currentSlot.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          currentSlot.setDate(currentSlot.getDate() + 1);
          currentSlot.setHours(9, 0, 0, 0);
          continue;
        }

        const slotEnd = new Date(currentSlot.getTime() + slotDuration);

        // Check if this slot conflicts with any busy time
        const hasConflict = busyTimes.some((busy: any) => {
          const busyStart = new Date(busy.start);
          const busyEnd = new Date(busy.end);
          return currentSlot < busyEnd && slotEnd > busyStart;
        });

        if (!hasConflict) {
          console.log(`✅ Found available slot: ${currentSlot.toLocaleString()}`);
          return currentSlot;
        }

        // Move to next 30-minute slot
        currentSlot = new Date(currentSlot.getTime() + 30 * 60 * 1000);
      }

      // If no slot found on target date, return default (next day 10 AM)
      console.log('⚠️ No free slot found, using default time');
      const defaultTime = targetDate ? new Date(targetDate) : new Date(now.getTime() + 24 * 60 * 60 * 1000);
      defaultTime.setHours(10, 0, 0, 0);
      return defaultTime;

    } catch (error) {
      console.error('Error finding available slot:', error);
      // Return default time on error
      const defaultTime = targetDate ? new Date(targetDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);
      defaultTime.setHours(10, 0, 0, 0);
      return defaultTime;
    }
  }

  isAuthenticated(): boolean {
    const credentials = this.oauth2Client.credentials;
    return !!(credentials && credentials.access_token);
  }

  getAuthToken(): string | null {
    return this.oauth2Client.credentials.access_token || null;
  }

  /**
   * Check if a specific time slot has conflicts
   */
  async checkConflict(startTime: Date, endTime: Date): Promise<boolean> {
    try {
      const response = await this.calendar.freebusy.query({
        requestBody: {
          timeMin: startTime.toISOString(),
          timeMax: endTime.toISOString(),
          items: [{ id: 'primary' }],
        },
      });

      const busyTimes = response.data.calendars?.primary?.busy || [];
      return busyTimes.length > 0;
    } catch (error) {
      console.error('Error checking conflict:', error);
      return false;
    }
  }

  /**
   * Get available time slots for a specific date
   * Returns slots from 9 AM to 6 PM, marking each as free or busy
   */
  async getTimeSlots(targetDate: Date, durationMinutes: number = 30): Promise<Array<{
    startTime: Date;
    endTime: Date;
    isFree: boolean;
  }>> {
    try {
      // Set search range: 9 AM to 6 PM on target date
      const searchStart = new Date(targetDate);
      searchStart.setHours(9, 0, 0, 0);
      
      const searchEnd = new Date(targetDate);
      searchEnd.setHours(18, 0, 0, 0);

      // If target date is today and it's past 9 AM, start from next half hour
      const now = new Date();
      if (searchStart < now) {
        searchStart.setTime(now.getTime());
        searchStart.setMinutes(Math.ceil(searchStart.getMinutes() / 30) * 30, 0, 0);
      }

      // Get busy times
      const response = await this.calendar.freebusy.query({
        requestBody: {
          timeMin: searchStart.toISOString(),
          timeMax: searchEnd.toISOString(),
          items: [{ id: 'primary' }],
        },
      });

      const busyTimes = response.data.calendars?.primary?.busy || [];

      // Generate all 30-minute slots
      const slots: Array<{ startTime: Date; endTime: Date; isFree: boolean }> = [];
      let currentSlot = new Date(searchStart);

      while (currentSlot < searchEnd) {
        const slotEnd = new Date(currentSlot.getTime() + durationMinutes * 60 * 1000);
        
        // Check if this slot conflicts with any busy time
        const hasConflict = busyTimes.some((busy: any) => {
          const busyStart = new Date(busy.start);
          const busyEnd = new Date(busy.end);
          return currentSlot < busyEnd && slotEnd > busyStart;
        });

        slots.push({
          startTime: new Date(currentSlot),
          endTime: new Date(slotEnd),
          isFree: !hasConflict,
        });

        // Move to next 30-minute slot
        currentSlot = new Date(currentSlot.getTime() + 30 * 60 * 1000);
      }

      return slots;
    } catch (error) {
      console.error('Error getting time slots:', error);
      return [];
    }
  }

  /**
   * Get free/busy information for multiple attendees
   * @param attendeeEmails - Array of attendee email addresses
   * @param startTime - Start time to check
   * @param endTime - End time to check
   * @returns Map of email to busy time slots
   */
  private calendarAccessErrors: Map<string, any[]> = new Map();

  async getAttendeesFreeBusy(
    attendeeEmails: string[],
    startTime: Date,
    endTime: Date
  ): Promise<Map<string, Array<{ start: Date; end: Date }>>> {
    try {
      console.log(`🔍 Checking free/busy for ${attendeeEmails.length} attendees (Google Calendar)`);
      
      const response = await this.calendar.freebusy.query({
        requestBody: {
          timeMin: startTime.toISOString(),
          timeMax: endTime.toISOString(),
          items: attendeeEmails.map(email => ({ id: email })),
        },
      });

      const result = new Map<string, Array<{ start: Date; end: Date }>>();
      this.calendarAccessErrors.clear();
      
      for (const email of attendeeEmails) {
        const calendarData = response.data.calendars?.[email];
        const busyTimes = calendarData?.busy || [];
        
        // Debug: log calendar errors if any
        if (calendarData?.errors && calendarData.errors.length > 0) {
          console.warn(`  ⚠️ ${email}: Calendar access errors:`, calendarData.errors);
          this.calendarAccessErrors.set(email, calendarData.errors);
        }
        
        result.set(email, busyTimes.map((busy: any) => ({
          start: new Date(busy.start),
          end: new Date(busy.end),
        })));
        
        console.log(`  ${email}: ${busyTimes.length} busy slot(s)`);
        if (busyTimes.length > 0) {
          busyTimes.forEach((busy: any) => {
            console.log(`    - ${new Date(busy.start).toLocaleString()} to ${new Date(busy.end).toLocaleString()}`);
          });
        }
      }

      return result;
    } catch (error) {
      console.error('Error getting attendees free/busy:', error);
      return new Map();
    }
  }

  getCalendarAccessErrors(): Map<string, any[]> {
    return this.calendarAccessErrors;
  }

  /**
   * Check if attendees have conflicts at the specified time
   * @param attendeeEmails - Array of attendee email addresses
   * @param startTime - Meeting start time
   * @param endTime - Meeting end time
   * @returns Conflict information
   */
  async checkAttendeesConflict(
    attendeeEmails: string[],
    startTime: Date,
    endTime: Date
  ): Promise<{ hasConflict: boolean; conflicts: Array<{ email: string; busySlots: number }>; calendarAccessIssues?: string[] }> {
    try {
      console.log(`⏰ Checking conflicts for ${attendeeEmails.length} attendees (Google Calendar)...`);
      console.log(`   Time: ${startTime.toISOString()} - ${endTime.toISOString()}`);
      
      const freeBusyMap = await this.getAttendeesFreeBusy(attendeeEmails, startTime, endTime);
      const conflicts: Array<{ email: string; busySlots: number }> = [];
      const calendarAccessIssues: string[] = [];
      
      // Check for calendar access errors
      const accessErrors = this.getCalendarAccessErrors();
      for (const [email, errors] of accessErrors.entries()) {
        const errorReasons = errors.map(e => e.reason).join(', ');
        calendarAccessIssues.push(`${email} (${errorReasons})`);
      }
      
      for (const [email, busySlots] of freeBusyMap.entries()) {
        if (busySlots.length > 0) {
          conflicts.push({ email, busySlots: busySlots.length });
          console.log(`   ⚠️ ${email} has ${busySlots.length} conflict(s)`);
        } else {
          console.log(`   ✅ ${email} is free`);
        }
      }
      
      const hasConflict = conflicts.length > 0;
      
      if (hasConflict) {
        console.log(`❌ ${conflicts.length} attendee(s) have conflicts`);
      } else {
        console.log(`✅ All attendees are free`);
      }
      
      if (calendarAccessIssues.length > 0) {
        console.warn(`⚠️ Warning: Cannot access calendar for: ${calendarAccessIssues.join(', ')}`);
        console.warn(`   This may result in scheduling conflicts. Please share calendars or use a different account.`);
      }
      
      return { hasConflict, conflicts, calendarAccessIssues };
    } catch (error) {
      console.error('Error checking attendees conflict:', error);
      return { hasConflict: false, conflicts: [] };
    }
  }

  /**
   * Get time slots considering multiple attendees' availability
   * @param targetDate - Date to check
   * @param durationMinutes - Meeting duration
   * @param attendeeEmails - Array of attendee emails
   * @returns Array of time slots with availability
   */
  async getTimeSlotsWithAttendees(
    targetDate: Date,
    durationMinutes: number = 30,
    attendeeEmails: string[] = []
  ): Promise<Array<{ startTime: Date; endTime: Date; isFree: boolean }>> {
    try {
      // Set search range: 9 AM to 6 PM on target date
      const searchStart = new Date(targetDate);
      searchStart.setHours(9, 0, 0, 0);
      
      const searchEnd = new Date(targetDate);
      searchEnd.setHours(18, 0, 0, 0);

      // If target date is today and it's past 9 AM, start from next half hour
      const now = new Date();
      if (searchStart < now) {
        searchStart.setTime(now.getTime());
        searchStart.setMinutes(Math.ceil(searchStart.getMinutes() / 30) * 30, 0, 0);
      }

      console.log(`📅 Getting time slots for ${targetDate.toDateString()} with ${attendeeEmails.length} attendees`);

      // Collect all busy times from all attendees
      const allBusyTimes: Array<{ start: Date; end: Date }> = [];
      
      if (attendeeEmails.length > 0) {
        const freeBusyMap = await this.getAttendeesFreeBusy(attendeeEmails, searchStart, searchEnd);
        
        for (const busySlots of freeBusyMap.values()) {
          allBusyTimes.push(...busySlots);
        }
      }

      console.log(`   Found ${allBusyTimes.length} total busy time slots`);

      // Generate all 30-minute slots
      const slots: Array<{ startTime: Date; endTime: Date; isFree: boolean }> = [];
      let currentSlot = new Date(searchStart);

      while (currentSlot < searchEnd) {
        const slotEnd = new Date(currentSlot.getTime() + durationMinutes * 60 * 1000);
        
        // Check if this slot conflicts with any busy time
        const hasConflict = allBusyTimes.some(busy => {
          return currentSlot < busy.end && slotEnd > busy.start;
        });

        slots.push({
          startTime: new Date(currentSlot),
          endTime: new Date(slotEnd),
          isFree: !hasConflict,
        });

        // Move to next 30-minute slot
        currentSlot = new Date(currentSlot.getTime() + 30 * 60 * 1000);
      }

      const freeSlots = slots.filter(s => s.isFree).length;
      console.log(`   Generated ${slots.length} slots, ${freeSlots} free`);

      return slots;
    } catch (error) {
      console.error('Error getting time slots with attendees:', error);
      return [];
    }
  }

  /**
   * Find next available slot considering attendees' availability
   * @param startFrom - Start searching from this time
   * @param durationMinutes - Meeting duration
   * @param attendeeEmails - Array of attendee emails
   * @returns Next available start time
   */
  async findNextAvailableSlotWithAttendees(
    startFrom: Date | undefined,
    durationMinutes: number = 30,
    attendeeEmails: string[] = []
  ): Promise<Date> {
    const searchDate = startFrom || new Date();
    
    // Get time slots for today
    const slots = await this.getTimeSlotsWithAttendees(searchDate, durationMinutes, attendeeEmails);
    
    // Find first free slot
    const freeSlot = slots.find(slot => slot.isFree);
    
    if (freeSlot) {
      return freeSlot.startTime;
    }
    
    // If no free slot today, try tomorrow
    const tomorrow = new Date(searchDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    
    const tomorrowSlots = await this.getTimeSlotsWithAttendees(tomorrow, durationMinutes, attendeeEmails);
    const tomorrowFreeSlot = tomorrowSlots.find(slot => slot.isFree);
    
    if (tomorrowFreeSlot) {
      return tomorrowFreeSlot.startTime;
    }
    
    // If still no slot, return tomorrow 9 AM
    return tomorrow;
  }

  /**
   * Create calendar event with attendees and optional Google Meet
   * @param summary - Event title
   * @param description - Event description
   * @param startTime - Start time
   * @param endTime - End time
   * @param attendeeEmails - Array of attendee emails
   * @param addMeetLink - Whether to add Google Meet link
   * @returns Created event data
   */
  async createCalendarEvent(
    summary: string,
    description: string,
    startTime: Date,
    endTime: Date,
    attendeeEmails: string[],
    addMeetLink: boolean = false
  ): Promise<any> {
    try {
      console.log(`📅 Creating Google Calendar event: ${summary}`);
      console.log(`   Start: ${startTime.toISOString()}, End: ${endTime.toISOString()}`);
      console.log(`   Attendees: ${attendeeEmails.length} email(s)`);

      const eventData: CalendarEvent = {
        summary,
        description,
        start: {
          dateTime: startTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        attendees: attendeeEmails.map(email => ({ email })),
      };

      // Add Google Meet link if requested
      if (addMeetLink) {
        eventData.conferenceData = {
          createRequest: {
            requestId: `meet-${Date.now()}`,
            conferenceSolutionKey: {
              type: 'hangoutsMeet',
            },
          },
        };
      }

      const createdEvent = await this.createEvent(eventData);
      
      console.log(`✅ Google Calendar event created: ${createdEvent.id}`);
      
      return {
        event_id: createdEvent.id,
        summary: createdEvent.summary,
        htmlLink: createdEvent.htmlLink,
        meetLink: createdEvent.hangoutLink || createdEvent.conferenceData?.entryPoints?.[0]?.uri,
        attendees: createdEvent.attendees,
      };
    } catch (error) {
      console.error('Error creating Google Calendar event:', error);
      throw error;
    }
  }

  /**
   * Delete calendar event
   * @param eventId - Event ID to delete
   * @param sendNotifications - Whether to send cancellation notifications
   */
  async deleteCalendarEvent(
    eventId: string,
    sendNotifications: boolean = false
  ): Promise<void> {
    try {
      console.log(`🗑️ Deleting Google Calendar event: ${eventId}`);
      
      await this.calendar.events.delete({
        calendarId: 'primary',
        eventId,
        sendUpdates: sendNotifications ? 'all' : 'none',
      });

      console.log(`✅ Google Calendar event deleted successfully`);
    } catch (error) {
      console.error('Error deleting Google Calendar event:', error);
      throw error;
    }
  }

  /**
   * Update calendar event
   * @param eventId - Event ID to update
   * @param updates - Fields to update
   * @returns Updated event data
   */
  async updateCalendarEvent(
    eventId: string,
    updates: {
      summary?: string;
      description?: string;
      startTime?: Date;
      endTime?: Date;
      sendNotifications?: boolean;
    }
  ): Promise<any> {
    try {
      console.log(`📝 Updating Google Calendar event: ${eventId}`);
      
      const updateData: any = {};
      
      if (updates.summary !== undefined) {
        updateData.summary = updates.summary;
      }
      
      if (updates.description !== undefined) {
        updateData.description = updates.description;
      }
      
      if (updates.startTime && updates.endTime) {
        updateData.start = {
          dateTime: updates.startTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        updateData.end = {
          dateTime: updates.endTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
      }

      const response = await this.calendar.events.patch({
        calendarId: 'primary',
        eventId,
        requestBody: updateData,
        sendUpdates: updates.sendNotifications ? 'all' : 'none',
      });

      console.log(`✅ Google Calendar event updated successfully`);
      
      return {
        event_id: response.data.id,
        summary: response.data.summary,
        htmlLink: response.data.htmlLink,
      };
    } catch (error) {
      console.error('Error updating Google Calendar event:', error);
      throw error;
    }
  }
}

