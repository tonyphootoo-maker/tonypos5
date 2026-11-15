import React, { useState, useEffect, useRef } from 'react';

export interface NumericInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: number | string | undefined | null;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onValueChange?: (val: number) => void;
  fallbackValue?: number;
  commitOnBlurOnly?: boolean;
}

function toDisplayString(
  val: number | string | undefined | null,
  allowZero: boolean
): string {
  if (val === undefined || val === null || val === '') return '';
  const num = Number(val);
  if (Number.isNaN(num)) return '';
  if (num === 0 && !allowZero) return '';
  return String(val);
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
  inputMode = 'decimal',
  className = '',
  ...props
}) => {
  const userTypedZeroRef = useRef(false);
  const isFocusedRef = useRef(false);

  const [text, setText] = useState<string>(() => toDisplayString(value, false));

  // Synchronize when value changes externally and input is NOT currently being edited by user
  useEffect(() => {
    if (!isFocusedRef.current) {
      const nextNum = Number(value);
      if (value !== undefined && value !== null && value !== '' && !Number.isNaN(nextNum) && nextNum !== 0) {
        userTypedZeroRef.current = false;
      }
      setText(toDisplayString(value, userTypedZeroRef.current));
    }
  }, [value]);

  const emitParentChange = (
    rawEvent: React.SyntheticEvent<HTMLInputElement>,
    rawValueString: string,
    numericVal: number
  ) => {
    if (onChange) {
      const targetEl = rawEvent.target as HTMLInputElement;
      const syntheticEvent = {
        ...rawEvent,
        target: {
          ...targetEl,
          value: rawValueString,
          valueAsNumber: numericVal,
        },
        currentTarget: {
          ...rawEvent.currentTarget,
          value: rawValueString,
          valueAsNumber: numericVal,
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      onChange(syntheticEvent);
    }
    if (onValueChange) {
      onValueChange(numericVal);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);

    const trimmed = raw.trim();
    if (trimmed === '') {
      userTypedZeroRef.current = false;
      if (!commitOnBlurOnly) {
        emitParentChange(e, '', fallbackValue);
      }
      return;
    }

    const isPartial =
      trimmed === '-' ||
      trimmed === '+' ||
      trimmed.endsWith('.') ||
      Number.isNaN(Number(trimmed));

    if (!commitOnBlurOnly && !isPartial) {
      const parsed = parseFloat(trimmed);
      userTypedZeroRef.current = parsed === 0;
      emitParentChange(e, raw, parsed);
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

    if (trimmed === '') {
      userTypedZeroRef.current = false;
      setText('');
      emitParentChange(e, '', fallbackValue);
      if (onBlur) onBlur(e);
      return;
    }

    const isPartial =
      trimmed === '-' ||
      trimmed === '+' ||
      trimmed.endsWith('.') ||
      Number.isNaN(Number(trimmed));

    const finalNum = isPartial ? fallbackValue : parseFloat(trimmed);
    userTypedZeroRef.current = !isPartial && finalNum === 0;

    if (isPartial && finalNum === 0) {
      setText('');
      emitParentChange(e, '', fallbackValue);
    } else {
      setText(String(finalNum));
      emitParentChange(e, String(finalNum), finalNum);
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
      inputMode={inputMode}
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
