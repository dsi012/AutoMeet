"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalendarService = void 0;
const googleapis_1 = require("googleapis");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
class CalendarService {
    constructor(clientId, clientSecret, redirectUri) {
        this.oauth2Client = new googleapis_1.google.auth.OAuth2(clientId, clientSecret, redirectUri);
        this.calendar = googleapis_1.google.calendar({ version: 'v3', auth: this.oauth2Client });
        this.tokenPath = path.join(electron_1.app.getPath('userData'), 'google-token.json');
        // Load saved token if exists
        this.loadToken();
    }
    loadToken() {
        try {
            if (fs.existsSync(this.tokenPath)) {
                const token = JSON.parse(fs.readFileSync(this.tokenPath, 'utf-8'));
                this.oauth2Client.setCredentials(token);
            }
        }
        catch (error) {
            console.error('Error loading token:', error);
        }
    }
    saveToken(token) {
        try {
            fs.writeFileSync(this.tokenPath, JSON.stringify(token));
        }
        catch (error) {
            console.error('Error saving token:', error);
        }
    }
    async authenticate() {
        return new Promise((resolve, reject) => {
            const authUrl = this.oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: [
                    'https://www.googleapis.com/auth/calendar',
                    'https://www.googleapis.com/auth/calendar.events',
                ],
            });
            // Open auth window
            const authWindow = new electron_1.BrowserWindow({
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
                        }
                        catch (error) {
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
    async createEvent(eventData) {
        try {
            const insertParams = {
                calendarId: 'primary',
                requestBody: eventData,
            };
            // Only add conferenceDataVersion if conferenceData is present
            if (eventData.conferenceData) {
                insertParams.conferenceDataVersion = 1;
            }
            const response = await this.calendar.events.insert(insertParams);
            return response.data;
        }
        catch (error) {
            console.error('Error creating calendar event:', error);
            throw error;
        }
    }
    async getEvent(eventId) {
        try {
            const response = await this.calendar.events.get({
                calendarId: 'primary',
                eventId,
            });
            return response.data;
        }
        catch (error) {
            console.error('Error getting calendar event:', error);
            throw error;
        }
    }
    async updateEvent(eventId, eventData) {
        try {
            const response = await this.calendar.events.patch({
                calendarId: 'primary',
                eventId,
                requestBody: eventData,
            });
            return response.data;
        }
        catch (error) {
            console.error('Error updating calendar event:', error);
            throw error;
        }
    }
    async deleteEvent(eventId) {
        try {
            await this.calendar.events.delete({
                calendarId: 'primary',
                eventId,
            });
            console.log('✅ Calendar event deleted:', eventId);
        }
        catch (error) {
            console.error('Error deleting calendar event:', error);
            throw error;
        }
    }
    async listRecentEvents(maxResults = 10) {
        try {
            const response = await this.calendar.events.list({
                calendarId: 'primary',
                timeMin: new Date().toISOString(),
                maxResults,
                singleEvents: true,
                orderBy: 'startTime',
            });
            return response.data.items || [];
        }
        catch (error) {
            console.error('Error listing calendar events:', error);
            throw error;
        }
    }
    async findFreeSlots(attendees, durationMinutes = 30, daysAhead = 7) {
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
        }
        catch (error) {
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
    async findNextAvailableSlot(targetDate, durationMinutes = 30) {
        try {
            const now = new Date();
            let searchStart;
            let searchEnd;
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
            }
            else {
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
                const hasConflict = busyTimes.some((busy) => {
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
        }
        catch (error) {
            console.error('Error finding available slot:', error);
            // Return default time on error
            const defaultTime = targetDate ? new Date(targetDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);
            defaultTime.setHours(10, 0, 0, 0);
            return defaultTime;
        }
    }
    isAuthenticated() {
        const credentials = this.oauth2Client.credentials;
        return !!(credentials && credentials.access_token);
    }
    getAuthToken() {
        return this.oauth2Client.credentials.access_token || null;
    }
    /**
     * Check if a specific time slot has conflicts
     */
    async checkConflict(startTime, endTime) {
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
        }
        catch (error) {
            console.error('Error checking conflict:', error);
            return false;
        }
    }
    /**
     * Get available time slots for a specific date
     * Returns slots from 9 AM to 6 PM, marking each as free or busy
     */
    async getTimeSlots(targetDate, durationMinutes = 30) {
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
            const slots = [];
            let currentSlot = new Date(searchStart);
            while (currentSlot < searchEnd) {
                const slotEnd = new Date(currentSlot.getTime() + durationMinutes * 60 * 1000);
                // Check if this slot conflicts with any busy time
                const hasConflict = busyTimes.some((busy) => {
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
        }
        catch (error) {
            console.error('Error getting time slots:', error);
            return [];
        }
    }
}
exports.CalendarService = CalendarService;
