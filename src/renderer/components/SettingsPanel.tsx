import { useState, useEffect, useRef } from 'react';

interface SettingsPanelProps {
  // No props needed anymore
}

export default function SettingsPanel({}: SettingsPanelProps) {
  const [settings, setSettings] = useState({
    elevenlabsApiKey: '',
    openaiApiKey: '',
    anthropicApiKey: '',
    googleClientId: '',
    googleClientSecret: '',
  });

  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [isGoogleAuthenticated, setIsGoogleAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDropped, setIsDropped] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [contactFiles, setContactFiles] = useState<Array<{ fileName: string; contactCount: number; uploadTime: Date }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSettings();
    loadContactFiles();
    checkGoogleAuthStatus();
  }, []);

  const loadSettings = async () => {
    if (!window.electronAPI?.loadSettings) return;
    
    try {
      const savedSettings = await window.electronAPI.loadSettings();
      if (savedSettings) {
        console.log('✅ Loaded persisted settings');
        setSettings({
          elevenlabsApiKey: savedSettings.elevenlabsApiKey || '',
          openaiApiKey: savedSettings.openaiApiKey || '',
          anthropicApiKey: savedSettings.anthropicApiKey || '',
          googleClientId: savedSettings.googleClientId || '',
          googleClientSecret: savedSettings.googleClientSecret || '',
        });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const loadContactFiles = async () => {
    if (!window.electronAPI?.getContactsFiles) return;
    
    try {
      const files = await window.electronAPI.getContactsFiles();
      setContactFiles(files);
    } catch (error) {
      console.error('Failed to load contact files:', error);
    }
  };

  const checkGoogleAuthStatus = async () => {
    if (!window.electronAPI?.checkGoogleAuthStatus) return;
    
    try {
      const isAuthenticated = await window.electronAPI.checkGoogleAuthStatus();
      setIsGoogleAuthenticated(isAuthenticated);
    } catch (error) {
      console.error('Failed to check Google auth status:', error);
      setIsGoogleAuthenticated(false);
    }
  };

  const handleDeleteFile = async (fileName: string) => {
    if (!window.electronAPI?.deleteContactsFile) return;
    
    if (!confirm(`Delete ${fileName}?`)) return;
    
    try {
      await window.electronAPI.deleteContactsFile(fileName);
      await loadContactFiles();
      setUploadMessage(`✅ Deleted ${fileName}`);
      setTimeout(() => setUploadMessage(''), 3000);
    } catch (error: any) {
      console.error('Failed to delete file:', error);
      setUploadMessage(`❌ Failed to delete file`);
      setTimeout(() => setUploadMessage(''), 3000);
    }
  };

  const handleSave = async () => {
    if (!window.electronAPI?.saveSettings || !window.electronAPI?.initializeServices) return;
    
    setIsSaving(true);
    setSaveMessage('');
    
    try {
      // Filter out empty values
      const filteredSettings: any = {};
      Object.entries(settings).forEach(([key, value]) => {
        if (value && value.trim()) {
          filteredSettings[key] = value.trim();
        }
      });

      if (Object.keys(filteredSettings).length === 0) {
        setSaveMessage('⚠️ No settings to save');
        setIsSaving(false);
        return;
      }

      // Save settings to disk
      await window.electronAPI.saveSettings(filteredSettings);
      
      // Initialize services with the new settings
      await window.electronAPI.initializeServices(filteredSettings);
      
      setSaveMessage('✅ Settings saved successfully!');
      
      // Check if Google credentials changed
      const savedSettings = await window.electronAPI.loadSettings();
      const credentialsChanged = 
        savedSettings?.googleClientId !== filteredSettings.googleClientId ||
        savedSettings?.googleClientSecret !== filteredSettings.googleClientSecret;
      
      // If Google credentials were changed, reset auth status
      if (credentialsChanged && filteredSettings.googleClientId && filteredSettings.googleClientSecret) {
        setIsGoogleAuthenticated(false);
      } else {
        // Otherwise, check current auth status
        await checkGoogleAuthStatus();
      }
      
      // Clear the message after 3 seconds
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveMessage('❌ Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleInputChange = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      // Show drop success feedback immediately
      setIsDropped(true);
      setUploadMessage('');
      
      // Small delay to show drop feedback before starting upload
      setTimeout(async () => {
        await handleFileUpload(files[0]);
        setIsDropped(false);
      }, 300);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setIsDropped(true);
      setUploadMessage('');
      
      // Small delay to show drop feedback before starting upload
      setTimeout(async () => {
        await handleFileUpload(files[0]);
        setIsDropped(false);
      }, 300);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      setIsDropped(false);
      setUploadMessage('❌ Please upload a CSV file');
      setTimeout(() => setUploadMessage(''), 3000);
      return;
    }

    setIsUploading(true);
    setUploadMessage('');

    try {
      const fileContent = await file.text();
      
      if (!window.electronAPI?.uploadContactsCSV) {
        throw new Error('Upload API not available');
      }

      const result = await window.electronAPI.uploadContactsCSV(fileContent, file.name);
      
      // Update contacts files list
      await loadContactFiles();
      
      setUploadMessage(`✅ ${result.message}`);
      setTimeout(() => setUploadMessage(''), 5000);
    } catch (error: any) {
      console.error('Failed to upload CSV:', error);
      setUploadMessage(`❌ ${error.message || 'Failed to upload CSV file'}`);
      setTimeout(() => setUploadMessage(''), 5000);
    } finally {
      setIsUploading(false);
      setIsDropped(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleGoogleAuth = async () => {
    if (!window.electronAPI?.authenticateGoogle) return;
    
    setIsAuthenticating(true);
    setSaveMessage('');
    
    try {
      await window.electronAPI.authenticateGoogle();
      
      // Verify authentication was successful
      const isAuthenticated = await window.electronAPI.checkGoogleAuthStatus();
      setIsGoogleAuthenticated(isAuthenticated);
      
      if (isAuthenticated) {
        setSaveMessage('✅ Google account connected successfully!');
      } else {
        setSaveMessage('⚠️ Authentication completed but verification failed');
      }
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error: any) {
      console.error('Google authentication failed:', error);
      setSaveMessage(`❌ Authentication failed: ${error.message || 'Unknown error'}`);
      setIsGoogleAuthenticated(false);
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <div className="h-full flex flex-col pl-3 pr-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 h-5">
        <h3 className="text-sm font-medium text-gray-200">Settings</h3>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto rounded-lg border border-gray-200/30 p-4 space-y-6">

        {/* ElevenLabs API Key */}
        <div>
          <label className="block text-xs font-medium text-gray-200 mb-1">
            ElevenLabs API Key
          </label>
          <input
            type="password"
            value={settings.elevenlabsApiKey}
            onChange={(e) => handleInputChange('elevenlabsApiKey', e.target.value)}
            placeholder="Enter your ElevenLabs API key"
            className="w-full px-3 py-2 bg-gray-700/30 border border-gray-200/30 rounded text-sm text-gray-200 placeholder-gray-400/60 focus:outline-none focus:border-blue-500"
          />
          <p className="mt-1 text-xs text-gray-400/80">
            For text-to-speech functionality
          </p>
        </div>

        {/* OpenAI API Key */}
        <div>
          <label className="block text-xs font-medium text-gray-200 mb-1">
            OpenAI API Key
          </label>
          <input
            type="password"
            value={settings.openaiApiKey}
            onChange={(e) => handleInputChange('openaiApiKey', e.target.value)}
            placeholder="Enter your OpenAI API key"
            className="w-full px-3 py-2 bg-gray-700/30 border border-gray-200/30 rounded text-sm text-gray-200 placeholder-gray-400/60 focus:outline-none focus:border-blue-500"
          />
          <p className="mt-1 text-xs text-gray-400/80">
            For GPT-based meeting detection
          </p>
        </div>

        {/* Anthropic API Key */}
        <div>
          <label className="block text-xs font-medium text-gray-200 mb-1">
            Anthropic API Key (Optional)
          </label>
          <input
            type="password"
            value={settings.anthropicApiKey}
            onChange={(e) => handleInputChange('anthropicApiKey', e.target.value)}
            placeholder="Enter your Anthropic API key"
            className="w-full px-3 py-2 bg-gray-700/30 border border-gray-200/30 rounded text-sm text-gray-200 placeholder-gray-400/60 focus:outline-none focus:border-blue-500"
          />
          <p className="mt-1 text-xs text-gray-400/80">
            For Claude-based meeting detection
          </p>
        </div>

        {/* Google Calendar Credentials */}
        <div className="space-y-3 pt-4 border-t border-gray-200/20">
          <h3 className="text-xs font-semibold text-gray-200">Google Calendar</h3>
          
          <div>
            <label className="block text-xs font-medium text-gray-200 mb-1">
              Client ID
            </label>
            <input
              type="text"
              value={settings.googleClientId}
              onChange={(e) => handleInputChange('googleClientId', e.target.value)}
              placeholder="Enter Google OAuth Client ID"
              className="w-full px-3 py-2 bg-gray-700/30 border border-gray-200/30 rounded text-sm text-gray-200 placeholder-gray-400/60 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-200 mb-1">
              Client Secret
            </label>
            <input
              type="password"
              value={settings.googleClientSecret}
              onChange={(e) => handleInputChange('googleClientSecret', e.target.value)}
              placeholder="Enter Google OAuth Client Secret"
              className="w-full px-3 py-2 bg-gray-700/30 border border-gray-200/30 rounded text-sm text-gray-200 placeholder-gray-400/60 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Google Authentication Button */}
          <div>
            <button
              onClick={handleGoogleAuth}
              disabled={isAuthenticating || !settings.googleClientId || !settings.googleClientSecret}
              className={`w-full px-4 py-2 rounded text-sm font-medium transition-colors ${
                isGoogleAuthenticated
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-600 disabled:cursor-not-allowed'
              }`}
            >
              {isAuthenticating ? (
                'Authenticating...'
              ) : isGoogleAuthenticated ? (
                '✓ Connected to Google'
              ) : (
                'Connect Google Account'
              )}
            </button>
            <p className="mt-1 text-xs text-gray-400/80">
              {isGoogleAuthenticated 
                ? 'Your Google account is connected and ready to use'
                : 'Save your Client ID and Secret first, then click to authenticate'
              }
            </p>
          </div>
        </div>

        {/* Contacts Data Source */}
        <div className="space-y-3 pt-4 border-t border-gray-200/20">
          <h3 className="text-xs font-semibold text-gray-200">Contacts</h3>
          
          <div>
            <label className="block text-xs font-medium text-gray-200 mb-2">
              Upload Contacts CSV File
            </label>

            {/* Current Loaded CSV Files */}
            {contactFiles.length > 0 && (
              <div className="mb-3 space-y-2">
                {contactFiles.map((file) => (
                  <div 
                    key={file.fileName}
                    className="p-3 bg-gray-700/30 border border-gray-200/20 rounded-lg hover:bg-gray-700/40 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {/* File Icon */}
                      <svg
                        className="w-8 h-8 text-gray-300 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 font-medium truncate">
                          {file.fileName}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {file.contactCount} contact{file.contactCount !== 1 ? 's' : ''}
                          {' · '}
                          {new Date(file.uploadTime).toLocaleDateString()}
                        </p>
                      </div>
                      {/* Delete Button */}
                      <button
                        onClick={() => handleDeleteFile(file.fileName)}
                        className="flex-shrink-0 p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        title="Delete file"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {/* Drag and Drop Area */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all duration-200
                ${isDropped 
                  ? 'border-green-500 bg-green-500/10' 
                  : isDragging 
                    ? 'border-blue-500 bg-blue-500/10' 
                    : 'border-gray-200/30 bg-gray-700/20 hover:bg-gray-700/30'
                }
                ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
                disabled={isUploading || isDropped}
              />
              
              {isUploading ? (
                <div className="flex flex-col items-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-2"></div>
                  <p className="text-sm text-gray-300">Uploading...</p>
                </div>
              ) : isDropped ? (
                <div className="flex flex-col items-center">
                  <svg
                    className="w-10 h-10 text-green-500 mb-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <p className="text-sm text-green-400 font-medium mb-1">
                    File dropped! Processing...
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <svg
                    className="w-10 h-10 text-gray-400 mb-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <p className="text-sm text-gray-200 mb-1">
                    {isDragging ? 'Drop CSV file here' : 'Drag & drop CSV file here'}
                  </p>
                  <p className="text-xs text-gray-400/80">
                    or click to browse
                  </p>
                </div>
              )}
            </div>
            
            {uploadMessage && (
              <div className={`mt-2 text-xs text-center ${
                uploadMessage.startsWith('✅') ? 'text-green-400' : 'text-red-400'
              }`}>
                {uploadMessage}
              </div>
            )}
            
            <p className="mt-2 text-xs text-gray-400/80">
              CSV format: name,email,timezone
            </p>
            <p className="text-xs text-gray-400/80">
              The file will be saved to contacts.csv and used immediately.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 space-y-2">
        {saveMessage && (
          <div className="text-xs text-center text-gray-200">
            {saveMessage}
          </div>
        )}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 text-white text-sm font-medium rounded transition-colors disabled:cursor-not-allowed"
        >
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
