import * as fs from 'fs';
import * as path from 'path';

export class ContactService {
  private contacts: Map<string, { name: string; email?: string; mobile?: string; timezone?: string }> = new Map();
  private contactsDir: string;
  private onContactsUpdatedCallback: (() => void) | null = null;

  constructor(customPath?: string) {
    // Support custom path for testing, or use Electron app path
    if (customPath) {
      this.contactsDir = customPath;
    } else {
      // Try to use Electron app if available
      try {
        const { app } = require('electron');
        this.contactsDir = path.join(app.getAppPath(), 'contacts');
      } catch {
        // Fallback to current directory if Electron is not available
        this.contactsDir = path.join(process.cwd(), 'contacts');
      }
    }
    
    // Create contacts directory if it doesn't exist
    if (!fs.existsSync(this.contactsDir)) {
      fs.mkdirSync(this.contactsDir, { recursive: true });
    }
    
    console.log('📁 Using contacts directory:', this.contactsDir);
    
    // Initial load from all CSV files
    this.loadAllCSVFiles();
  }


  /**
   * Load contacts from all CSV files in the contacts directory
   */
  private loadAllCSVFiles() {
    try {
      this.contacts.clear();
      
      if (!fs.existsSync(this.contactsDir)) {
        console.warn(`Contacts directory not found: ${this.contactsDir}`);
        return;
      }

      const files = fs.readdirSync(this.contactsDir);
      const csvFiles = files.filter(f => f.endsWith('.csv'));
      
      if (csvFiles.length === 0) {
        console.log('No CSV files found in contacts directory');
        return;
      }

      for (const file of csvFiles) {
        const filePath = path.join(this.contactsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        this.parseCSVContent(content);
      }
      
      console.log(`✅ Loaded ${this.contacts.size} contacts from ${csvFiles.length} CSV file(s)`);
    } catch (error) {
      console.error('Error loading contacts from CSV files:', error);
    }
  }

  /**
   * Get list of all CSV files
   */
  getCSVFiles(): Array<{ fileName: string; contactCount: number; uploadTime: Date }> {
    try {
      if (!fs.existsSync(this.contactsDir)) {
        return [];
      }

      const files = fs.readdirSync(this.contactsDir);
      const csvFiles = files.filter(f => f.endsWith('.csv'));
      
      return csvFiles.map(fileName => {
        const filePath = path.join(this.contactsDir, fileName);
        const stats = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        const contactCount = Math.max(0, lines.length - 1); // Exclude header
        
        return {
          fileName,
          contactCount,
          uploadTime: stats.mtime,
        };
      }).sort((a, b) => b.uploadTime.getTime() - a.uploadTime.getTime());
    } catch (error) {
      console.error('Error getting CSV files:', error);
      return [];
    }
  }

  /**
   * Delete a specific CSV file
   */
  deleteCSVFile(fileName: string): boolean {
    try {
      const filePath = path.join(this.contactsDir, fileName);
      
      if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${fileName}`);
        return false;
      }

      fs.unlinkSync(filePath);
      console.log(`🗑️  Deleted CSV file: ${fileName}`);
      
      // Reload all contacts
      this.loadAllCSVFiles();
      
      // Notify callback
      if (this.onContactsUpdatedCallback) {
        this.onContactsUpdatedCallback();
      }
      
      return true;
    } catch (error) {
      console.error(`Error deleting CSV file ${fileName}:`, error);
      return false;
    }
  }

  /**
   * Parse CSV content and populate contacts map
   * Expected format: name,email,timezone
   * Backward compatible: can handle more columns but only uses first 3
   */
  private parseCSVContent(content: string) {
    const lines = content.split('\n');
    
    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Parse CSV: name,email,timezone (simplified format)
      // Backward compatible: ignores extra columns if present
      const parts = line.split(',').map(s => s.trim());
      const name = parts[0];
      const email = parts[1] || '';
      const timezone = parts[2] || '';
      
      if (name) {
        // Store with lowercase key for case-insensitive lookup, but keep original name
        this.contacts.set(name.toLowerCase(), { 
          name, 
          email: email || undefined,
          mobile: undefined, // Not used in simplified format
          timezone: timezone || undefined
        });
        const contactInfo: string[] = [];
        if (email) contactInfo.push(`Email: ${email}`);
        if (timezone) contactInfo.push(`TZ: ${timezone}`);
        console.log(`Loaded contact: ${name}${contactInfo.length > 0 ? ' (' + contactInfo.join(', ') + ')' : ''}`);
      }
    }
  }

  /**
   * Get email for a given name
   * @param name The name to look up (case-insensitive)
   * @returns Email address if found, null otherwise
   */
  getEmail(name: string): string | null {
    if (!name) return null;
    const contact = this.contacts.get(name.toLowerCase());
    return contact?.email || null;
  }

  /**
   * Get mobile for a given name
   * @param name The name to look up (case-insensitive)
   * @returns Mobile number if found, null otherwise
   */
  getMobile(name: string): string | null {
    if (!name) return null;
    const contact = this.contacts.get(name.toLowerCase());
    return contact?.mobile || null;
  }

  /**
   * Get emails for multiple names
   * @param names Array of names to look up
   * @returns Array of email addresses (only valid ones)
   */
  getEmails(names: string[]): string[] {
    if (!names || names.length === 0) return [];
    
    const emails: string[] = [];
    for (const name of names) {
      const email = this.getEmail(name);
      if (email) {
        emails.push(email);
      }
    }
    return emails;
  }

  /**
   * Get mobiles for multiple names
   * @param names Array of names to look up
   * @returns Array of mobile numbers (only valid ones)
   */
  getMobiles(names: string[]): string[] {
    if (!names || names.length === 0) return [];
    
    const mobiles: string[] = [];
    for (const name of names) {
      const mobile = this.getMobile(name);
      if (mobile) {
        mobiles.push(mobile);
      }
    }
    return mobiles;
  }

  /**
   * Get contact info (email or mobile) for names
   * @param names Array of names to look up
   * @returns Object with emails and mobiles arrays
   */
  getContactInfo(names: string[]): { emails: string[]; mobiles: string[] } {
    if (!names || names.length === 0) return { emails: [], mobiles: [] };
    
    const emails: string[] = [];
    const mobiles: string[] = [];
    
    for (const name of names) {
      const contact = this.contacts.get(name.toLowerCase());
      if (contact) {
        if (contact.email) emails.push(contact.email);
        if (contact.mobile) mobiles.push(contact.mobile);
      } else {
        console.warn(`No contact info found for: ${name}`);
      }
    }
    
    return { emails, mobiles };
  }

  /**
   * Load contacts from CSV content string and save to file
   * @param csvContent CSV content string
   * @param fileName File name to save as
   */
  async loadFromCSVContent(csvContent: string, fileName: string): Promise<void> {
    try {
      // Ensure the file has .csv extension
      if (!fileName.endsWith('.csv')) {
        fileName += '.csv';
      }
      
      // Save to contacts directory
      const filePath = path.join(this.contactsDir, fileName);
      fs.writeFileSync(filePath, csvContent, 'utf-8');
      console.log(`💾 Saved CSV file: ${fileName}`);
      
      // Reload all contacts from all CSV files
      this.loadAllCSVFiles();
      
      console.log(`✅ Loaded ${this.contacts.size} total contacts from all CSV files`);
      
      // Notify callback that contacts have been updated
      if (this.onContactsUpdatedCallback) {
        this.onContactsUpdatedCallback();
      }
    } catch (error) {
      console.error('Error loading contacts from CSV content:', error);
      throw error;
    }
  }

  /**
   * Reload contacts from all CSV files
   */
  async reload(): Promise<void> {
    this.loadAllCSVFiles();
  }

  /**
   * Synchronous reload (for backwards compatibility)
   */
  reloadSync() {
    this.loadAllCSVFiles();
  }

  /**
   * Get contact by name
   * @param name The name to look up (case-insensitive)
   * @returns Contact object if found, null otherwise
   */
  getContact(name: string): { name: string; email?: string; mobile?: string; timezone?: string } | null {
    if (!name) return null;
    return this.contacts.get(name.toLowerCase()) || null;
  }

  /**
   * Get timezone for a given name
   * @param name The name to look up (case-insensitive)
   * @returns Timezone string if found, null otherwise
   */
  getTimezone(name: string): string | null {
    if (!name) return null;
    const contact = this.contacts.get(name.toLowerCase());
    return contact?.timezone || null;
  }

  /**
   * Get all contacts
   */
  getAllContacts(): Map<string, { name: string; email?: string; mobile?: string; timezone?: string }> {
    return new Map(this.contacts);
  }

  /**
   * Set callback to be called when contacts are updated
   */
  onContactsUpdated(callback: () => void): void {
    this.onContactsUpdatedCallback = callback;
  }
}
