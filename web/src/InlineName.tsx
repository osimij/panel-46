import { useEffect, useRef, useState } from "react";

/**
 * A one-line name field: Enter or clicking away saves, Escape cancels.
 * If the field disappears any other way (e.g. a button closes the editor;
 * Safari doesn't blur the field when you click a button), the edit is saved too.
 */
export function InlineName(props: {
  initial: string;
  placeholder?: string;
  className?: string;
  onDone: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(props.initial);
  const finished = useRef(false); // Enter unmounts the field, which also fires blur
  const latest = useRef({ value, onDone: props.onDone, initial: props.initial });
  latest.current = { value, onDone: props.onDone, initial: props.initial };

  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (save) props.onDone(value.trim());
    else props.onCancel();
  };

  useEffect(
    () => () => {
      const { value, onDone, initial } = latest.current;
      if (!finished.current && value.trim() !== initial.trim()) {
        finished.current = true;
        onDone(value.trim());
      }
    },
    [],
  );

  return (
    <input
      className={props.className ?? "side-input"}
      autoFocus
      value={value}
      placeholder={props.placeholder}
      size={props.className ? Math.max(value.length, 3) : undefined}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
    />
  );
}
