interface StatusPanelProps {
  isListening: boolean;
  micPermission: 'granted' | 'denied' | 'prompt';
  onToggleListening: () => void;
  onRequestPermission: () => void;
  isGoogleConnected: boolean;
  onConnectGoogle: () => void;
}

export default function StatusPanel({
  isListening,
  micPermission,
  onToggleListening,
  onRequestPermission,
  isGoogleConnected,
  onConnectGoogle,
}: StatusPanelProps) {
  return (
    <div className="rounded-lg border border-gray-600/50 p-3">
      <div className="flex items-center justify-between">
        {/* Status indicator */}
        <div className="flex items-center space-x-3">
          {/* Microphone Permission */}
          <div className="flex items-center space-x-1.5">
            <div className={`w-2 h-2 rounded-full ${
              micPermission === 'granted' ? 'bg-green-500' : 
              micPermission === 'denied' ? 'bg-red-500' : 'bg-yellow-500'
            }`} />
            {micPermission !== 'granted' && (
              <button
                onClick={onRequestPermission}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Grant Mic
              </button>
            )}
          </div>

          {/* Google Calendar */}
          <div className="flex items-center space-x-1.5">
            <div className={`w-2 h-2 rounded-full ${
              isGoogleConnected ? 'bg-green-500' : 'bg-gray-600'
            }`} />
            {!isGoogleConnected && (
              <button
                onClick={onConnectGoogle}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Connect Calendar
              </button>
            )}
          </div>
        </div>

        {/* Microphone button */}
        <button
          onClick={onToggleListening}
          disabled={micPermission !== 'granted'}
          className={`p-2 rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            isListening
              ? 'bg-red-500 hover:bg-red-600'
              : 'bg-blue-600 hover:bg-blue-500'
          }`}
          title={isListening ? 'Stop Listening' : 'Start Listening'}
        >
          {isListening ? (
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

