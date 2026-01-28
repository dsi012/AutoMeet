import { useEffect, useRef } from 'react';
import { TranscriptItem } from '../App';

interface TranscriptPanelProps {
  transcripts: TranscriptItem[];
}

export default function TranscriptPanel({ transcripts }: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom when new transcripts arrive
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  // Combine all transcripts into a continuous text
  const getContinuousText = () => {
    if (transcripts.length === 0) return '';
    
    return transcripts.map(t => t.text).join(' ');
  };

  // Get the last partial (non-final) transcript for highlighting
  const getLastPartialText = () => {
    if (transcripts.length === 0) return '';
    const lastTranscript = transcripts[transcripts.length - 1];
    return !lastTranscript.isFinal ? lastTranscript.text : '';
  };

  const continuousText = getContinuousText();
  const lastPartialText = getLastPartialText();

  return (
    <div className="h-full flex flex-col pl-3 pr-4 py-4">
      <div className="flex items-center justify-between mb-3 h-5">
        <h3 className="text-sm font-medium text-gray-200">Transcript</h3>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-lg border border-gray-200/30 p-4">
        {transcripts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-200">
            <svg className="w-12 h-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            <p className="text-sm text-gray-200">No transcripts yet</p>
          </div>
        ) : (
          <div className="text-gray-200 leading-relaxed text-sm whitespace-pre-wrap">
            {lastPartialText ? (
              <>
                {/* Final text (everything except the last partial) */}
                <span>{continuousText.slice(0, -lastPartialText.length)}</span>
                {/* Last partial text with highlight */}
                <span className="bg-blue-500/30 text-white px-1 rounded">
                  {lastPartialText}
                </span>
              </>
            ) : (
              /* All text is final */
              <span>{continuousText}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

