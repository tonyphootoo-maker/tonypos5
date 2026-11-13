import React, { useState, useEffect, useRef } from 'react';

export interface NumericInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: number | string | undefined | null;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onValueChange?: (val: number) => void;
  fallbackValue?: number;
  commitOnBlurOnly?: boolean;
}

export const NumericInput: React.FC<NumericInputProps> = ({
  value,
  onChange,
  onValueChange,
  onFocus,
  onBlur,
  onKeyDown,
  fallbackValue = 0,
  commitOnBlurOnly = false,
  type = 'number',
  className = '',
  ...props
}) => {
  const [text, setText] = useState<string>(() => {
    if (value === undefined || value === null || value === '') return '';
    return String(value);
  });
  const isFocusedRef = useRef(false);

  // Synchronize when value changes externally and input is NOT currently being edited by user
  useEffect(() => {
    if (!isFocusedRef.current) {
      if (value === undefined || value === null || value === '') {
        setText('');
      } else {
        setText(String(value));
      }
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);

    const trimmed = raw.trim();
    const isPartial =
      trimmed === '' ||
      trimmed === '-' ||
      trimmed === '+' ||
      trimmed.endsWith('.') ||
      isNaN(Number(trimmed));

    // Only update parent if not empty or partial (per user requirement)
    if (!commitOnBlurOnly && !isPartial) {
      const parsed = parseFloat(trimmed);
      if (onChange) {
        onChange(e);
      }
      if (onValueChange) {
        onValueChange(parsed);
      }
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = true;
    if (onFocus) {
      onFocus(e);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = false;
    const trimmed = text.trim();
    const isPartial =
      trimmed === '' ||
      trimmed === '-' ||
      trimmed === '+' ||
      trimmed.endsWith('.') ||
      isNaN(Number(trimmed));

    let finalNum: number = fallbackValue;
    if (!isPartial) {
      finalNum = parseFloat(trimmed);
    }

    // Set text representation on blur
    if (trimmed === '') {
      setText(fallbackValue !== undefined && fallbackValue !== null ? String(fallbackValue) : '');
    } else {
      setText(String(finalNum));
    }

    // Trigger parent callbacks
    if (onChange) {
      const syntheticEvent = {
        ...e,
        target: { ...e.target, value: String(finalNum), valueAsNumber: finalNum },
        currentTarget: { ...e.currentTarget, value: String(finalNum), valueAsNumber: finalNum },
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      onChange(syntheticEvent);
    }
    if (onValueChange) {
      onValueChange(finalNum);
    }

    if (onBlur) {
      onBlur(e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
    if (onKeyDown) {
      onKeyDown(e);
    }
  };

  return (
    <input
      {...props}
      type={type}
      value={text}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={className}
    />
  );
};

export default NumericInput;
