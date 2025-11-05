
import React from 'react';
import { ExternalLinkIcon } from './icons';
import { Source } from '../types';

interface SourcePillProps {
  source: Source;
  index: number;
}

const SourcePill: React.FC<SourcePillProps> = ({ source, index }) => {
  return (
    <a
      href={source.uri}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-teal-300 text-xs font-mono px-3 py-1 rounded-full transition-colors duration-200"
      title={source.title}
    >
      <span className="font-bold">{index + 1}</span>
      <span className="truncate max-w-48">{source.title || new URL(source.uri).hostname}</span>
      <ExternalLinkIcon className="w-4 h-4 flex-shrink-0" />
    </a>
  );
};

export default SourcePill;
