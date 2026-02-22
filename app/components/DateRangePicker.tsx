import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  format,
  startOfDay,
  endOfDay,
  subDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subMonths,
  subYears,
  isSameDay,
  isBefore,
  isAfter,
  addMonths,
  eachDayOfInterval,
  getDay,
  parseISO,
} from "date-fns";

const TIMEZONE = "America/New_York";

// Preset definitions
type PresetKey =
  | "today"
  | "yesterday"
  | "last7days"
  | "last14days"
  | "last30days"
  | "last90days"
  | "monthToDate"
  | "lastMonth"
  | "yearToDate"
  | "last12months"
  | "allTime";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7days", label: "Last 7 days" },
  { key: "last14days", label: "Last 14 days" },
  { key: "last30days", label: "Last 30 days" },
  { key: "last90days", label: "Last 90 days" },
  { key: "monthToDate", label: "Month to date" },
  { key: "lastMonth", label: "Last month" },
  { key: "yearToDate", label: "Year to date" },
  { key: "last12months", label: "Last 12 months" },
  { key: "allTime", label: "All time" },
];

// Helper to compute preset ranges
function getPresetRange(
  preset: PresetKey,
  availableMinISO?: string,
  availableMaxISO?: string
): { startISO: string; endISO: string } {
  const now = new Date();
  const today = startOfDay(now);
  const endOfToday = endOfDay(now);

  switch (preset) {
    case "today":
      return {
        startISO: format(today, "yyyy-MM-dd"),
        endISO: format(endOfToday, "yyyy-MM-dd"),
      };
    case "yesterday":
      const yesterday = subDays(today, 1);
      return {
        startISO: format(yesterday, "yyyy-MM-dd"),
        endISO: format(yesterday, "yyyy-MM-dd"),
      };
    case "last7days":
      return {
        startISO: format(subDays(today, 6), "yyyy-MM-dd"),
        endISO: format(endOfToday, "yyyy-MM-dd"),
      };
    case "last14days":
      return {
        startISO: format(subDays(today, 13), "yyyy-MM-dd"),
        endISO: format(endOfToday, "yyyy-MM-dd"),
      };
    case "last30days":
      return {
        startISO: format(subDays(today, 29), "yyyy-MM-dd"),
        endISO: format(endOfToday, "yyyy-MM-dd"),
      };
    case "last90days":
      return {
        startISO: format(subDays(today, 89), "yyyy-MM-dd"),
        endISO: format(endOfToday, "yyyy-MM-dd"),
      };
    case "monthToDate":
      return {
        startISO: format(startOfMonth(today), "yyyy-MM-dd"),
        endISO: format(endOfToday, "yyyy-MM-dd"),
      };
    case "lastMonth":
      const lastMonth = subMonths(today, 1);
      return {
        startISO: format(startOfMonth(lastMonth), "yyyy-MM-dd"),
        endISO: format(endOfMonth(lastMonth), "yyyy-MM-dd"),
      };
    case "yearToDate":
      return {
        startISO: format(startOfYear(today), "yyyy-MM-dd"),
        endISO: format(endOfToday, "yyyy-MM-dd"),
      };
    case "last12months":
      return {
        startISO: format(subMonths(today, 11), "yyyy-MM-dd"),
        endISO: format(endOfToday, "yyyy-MM-dd"),
      };
    case "allTime":
      return {
        startISO: availableMinISO || format(subYears(today, 2), "yyyy-MM-dd"),
        endISO: availableMaxISO || format(endOfToday, "yyyy-MM-dd"),
      };
    default:
      throw new Error(`Unknown preset: ${preset}`);
  }
}

// Format display label
function formatRangeLabel(value: { mode: "preset" | "custom"; preset?: PresetKey; startISO: string; endISO: string }): string {
  if (value.mode === "preset" && value.preset) {
    const preset = PRESETS.find(p => p.key === value.preset);
    return preset ? preset.label : "Custom";
  }

  const start = parseISO(value.startISO);
  
  // If no end date yet, show just the start date
  if (!value.endISO) {
    return format(start, "MMM d, yyyy");
  }

  const end = parseISO(value.endISO);

  if (isSameDay(start, end)) {
    return format(start, "MMM d, yyyy");
  }

  return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
}

// Calendar component
function Calendar({
  startDate,
  endDate,
  onSelect,
  availableMinISO,
  availableMaxISO,
}: {
  startDate: Date | null;
  endDate: Date | null;
  onSelect: (date: Date) => void;
  availableMinISO?: string;
  availableMaxISO?: string;
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const minDate = availableMinISO ? parseISO(availableMinISO) : null;
  const maxDate = availableMaxISO ? parseISO(availableMaxISO) : new Date();

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);

  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const isDateDisabled = (date: Date) => {
    if (minDate && isBefore(date, minDate)) return true;
    if (maxDate && isAfter(date, maxDate)) return true;
    return false;
  };

  const isDateSelected = (date: Date) => {
    if (!startDate) return false;
    
    // If we have both start and end, highlight the range
    if (endDate) {
      return !isBefore(date, startDate) && !isAfter(date, endDate);
    }
    
    // If only start exists, highlight just the start date
    return isSameDay(date, startDate);
  };

  const isDateStart = (date: Date) => startDate && isSameDay(date, startDate);
  const isDateEnd = (date: Date) => endDate && isSameDay(date, endDate);

  return (
    <div className="w-full max-w-full min-w-[280px]">
      {/* Month navigation */}
      <div className="flex justify-between items-center mb-3">
        <button
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          className="p-1 hover:bg-slate-100 rounded-md text-sm font-medium leading-5"
        >
          ‹
        </button>
        <div className="text-sm font-semibold text-slate-900 leading-5">{format(currentMonth, "MMMM yyyy")}</div>
        <button
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          className="p-1 hover:bg-slate-100 rounded-md text-sm font-medium leading-5"
        >
          ›
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
          <div key={day} className="h-6 flex items-center justify-center text-xs font-medium text-slate-500 leading-4">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((day) => {
          const disabled = isDateDisabled(day);
          const selected = isDateSelected(day);
          const isStart = isDateStart(day);
          const isEnd = isDateEnd(day);
          const isCurrentMonth = day.getMonth() === currentMonth.getMonth();

          return (
            <button
              key={day.toISOString()}
              onClick={() => !disabled && isCurrentMonth && onSelect(day)}
              disabled={disabled || !isCurrentMonth}
              className={`w-8 h-8 text-xs rounded-md transition-colors flex items-center justify-center leading-none ${
                !isCurrentMonth
                  ? "text-transparent cursor-default"
                  : disabled
                  ? "text-slate-300 cursor-not-allowed"
                  : selected
                  ? isStart || isEnd
                    ? "bg-slate-900 text-white font-medium"
                    : "bg-slate-100 text-slate-900"
                  : "hover:bg-slate-50 text-slate-700"
              }`}
            >
              {format(day, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Props
interface DateRangePickerProps {
  value: { mode: "preset" | "custom"; preset?: PresetKey; startISO: string; endISO: string };
  onChange: (value: { mode: "preset" | "custom"; preset?: PresetKey; startISO: string; endISO: string }) => void;
  availableMinISO?: string;
  availableMaxISO?: string;
  // Comparison props
  comparisonEnabled?: boolean;
  onComparisonEnabledChange?: (enabled: boolean) => void;
  compareMode?: "previous_period" | "previous_year";
  onCompareModeChange?: (mode: "previous_period" | "previous_year") => void;
}

// Internal draft state type (allows endISO to be undefined during selection)
type DraftState = {
  mode: "preset" | "custom";
  preset?: PresetKey;
  startISO: string;
  endISO?: string; // Optional during selection process
};

// Component
export default function DateRangePicker({ 
  value, 
  onChange, 
  availableMinISO, 
  availableMaxISO,
  comparisonEnabled = false,
  onComparisonEnabledChange,
  compareMode = "previous_period",
  onCompareModeChange
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<DraftState>({ ...value });
  const popoverRef = useRef<HTMLDivElement>(null);

  // Update draft when value changes
  useEffect(() => {
    setDraft({ ...value });
  }, [value]);

  // Handle outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Handle keyboard
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isOpen) return;
      
      if (event.key === "Escape") {
        handleCancel();
      } else if (event.key === "Enter" && draft.startISO) {
        handleApply();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, draft]);

  // Determine current preset or "custom"
  const currentPreset = useMemo(() => {
    if (draft.mode === "preset") return draft.preset;
    // Check if draft matches any preset
    for (const preset of PRESETS) {
      const range = getPresetRange(preset.key, availableMinISO, availableMaxISO);
      if (range.startISO === draft.startISO && range.endISO === draft.endISO) {
        return preset.key;
      }
    }
    return null;
  }, [draft, availableMinISO, availableMaxISO]);

  // Handle preset selection
  const handlePresetSelect = (preset: PresetKey) => {
    const range = getPresetRange(preset, availableMinISO, availableMaxISO);
    setDraft({ mode: "preset", preset, startISO: range.startISO, endISO: range.endISO });
  };

  // Handle calendar date selection
  const handleDateSelect = (date: Date) => {
    const dateISO = format(date, "yyyy-MM-dd");
    
    if (!draft.startISO || (draft.startISO && draft.endISO)) {
      // Start new range selection
      setDraft({ ...draft, mode: "custom", preset: undefined, startISO: dateISO, endISO: undefined });
    } else if (draft.startISO && !draft.endISO) {
      // Complete the range
      if (dateISO >= draft.startISO) {
        // Clicked date is after or equal to start - set as end
        setDraft({ ...draft, mode: "custom", preset: undefined, endISO: dateISO });
      } else {
        // Clicked date is before start - set as new start, keep end undefined
        setDraft({ ...draft, mode: "custom", preset: undefined, startISO: dateISO, endISO: undefined });
      }
    }
  };

  const startDate = draft.startISO ? parseISO(draft.startISO) : null;
  const endDate = draft.endISO ? parseISO(draft.endISO) : null;

  // Handle apply
  const handleApply = () => {
    // If only start is selected, treat as single-day range
    const finalDraft: { mode: "preset" | "custom"; preset?: PresetKey; startISO: string; endISO: string } = 
      draft.startISO && !draft.endISO 
        ? { ...draft, endISO: draft.startISO }
        : { ...draft, endISO: draft.endISO! }; // We know endISO exists here
    
    onChange(finalDraft);
    setIsOpen(false);
  };

  // Handle cancel
  const handleCancel = () => {
    setDraft(value);
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block">
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="rounded-xl border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
      >
        {formatRangeLabel(value)} ▾
      </button>

      {/* Popover */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/20 md:bg-transparent md:absolute md:inset-auto md:right-0 md:top-full md:mt-2 md:p-0 md:block">
          <div
            ref={popoverRef}
            className="w-full max-w-[600px] overflow-hidden bg-white border border-black/10 rounded-2xl shadow-xl p-4 origin-top-right max-h-[calc(100vh-32px)] overflow-y-auto md:max-h-none"
          >
          {/* Main content grid */}
          <div className="grid grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)] gap-4">
            {/* Presets column */}
            <div className="min-w-[200px]">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Presets</h3>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    onClick={() => handlePresetSelect(preset.key)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      currentPreset === preset.key
                        ? "bg-slate-900 text-white font-medium"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Calendar column */}
            <div className="min-w-[280px] min-w-0">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Custom Range</h3>
              <Calendar
                startDate={startDate}
                endDate={endDate}
                onSelect={handleDateSelect}
                availableMinISO={availableMinISO}
                availableMaxISO={availableMaxISO}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="mt-4 pt-3 border-t border-black/10">
            {/* Comparison Controls */}
            <div className="flex items-center justify-between mb-3">
              <label className="flex items-center gap-2 text-sm">
                <input 
                  type="checkbox" 
                  checked={comparisonEnabled} 
                  onChange={(e) => onComparisonEnabledChange?.(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Show comparison
              </label>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500">Mode</span>
                <select
                  value={compareMode}
                  disabled={!comparisonEnabled}
                  onChange={(e) => onCompareModeChange?.(e.target.value as "previous_period" | "previous_year")}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 disabled:opacity-60"
                >
                  <option value="previous_period">Previous period</option>
                  <option value="previous_year">Previous year</option>
                </select>
              </div>
            </div>

            {/* Bottom row with timezone and buttons */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-black/50">
                All dates in {TIMEZONE.replace("_", " ")}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApply}
                  className="px-4 py-2 text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}