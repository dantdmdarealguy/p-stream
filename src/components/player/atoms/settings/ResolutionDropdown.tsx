import { ChangeEvent } from "react";

import {
  DownloadResolution,
  ResolutionOption,
} from "@/components/player/utils/download/types";

interface ResolutionDropdownProps {
  options: ResolutionOption[];
  selected: DownloadResolution;
  onChange: (resolution: DownloadResolution) => void;
  disabled?: boolean;
}

export function ResolutionDropdown({
  options,
  selected,
  onChange,
  disabled,
}: ResolutionDropdownProps) {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onChange(event.target.value as DownloadResolution);
  };

  return (
    <div className="space-y-2">
      <label className="text-xs uppercase tracking-wide text-type-secondary">
        Resolution
      </label>
      <select
        className="w-full rounded-lg border border-video-context-border bg-video-context-hoverColor px-3 py-2 text-sm text-white focus:border-buttons-purple focus:outline-none"
        value={selected}
        onChange={handleChange}
        disabled={disabled}
      >
        {options.map((option) => (
          <option key={option.resolution} value={option.resolution}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
