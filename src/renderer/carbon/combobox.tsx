import { Dropdown } from "@carbon/react";
import { type KeyboardEventHandler, type ReactNode, type RefObject, useId } from "react";

interface ComboboxOption {
  id: string;
  label: string;
  title?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

/** Carbon owns selection, keyboard navigation and dismissal; callers retain tab identity. */
export function Combobox({
  label,
  value,
  options,
  disabled = false,
  onSelect,
  triggerRef,
  onTriggerKeyDown,
  placeholder = "",
  preserveCase = false,
}: {
  label: string;
  value: string;
  options: readonly ComboboxOption[];
  disabled?: boolean;
  onSelect(id: string): void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  onTriggerKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  placeholder?: string;
  preserveCase?: boolean;
}) {
  const id = useId();
  const selected = options.find((item) => item.id === value);
  const renderItem = (item: ComboboxOption | null) =>
    item ? (
      <span className="tab-choice" title={item.title}>
        {item.icon}
        <span>{item.label}</span>
      </span>
    ) : (
      <span>{placeholder}</span>
    );
  return (
    <Dropdown<ComboboxOption | null>
      id={id}
      {...(triggerRef ? { ref: triggerRef } : {})}
      titleText={label}
      hideLabel
      aria-label={label}
      label={placeholder || label}
      size="sm"
      autoAlign
      className="tab-selector"
      data-preserve-case={preserveCase || undefined}
      items={options.map((item) => ({ ...item }))}
      disabled={disabled}
      selectedItem={selected ?? null}
      itemToString={(item) => item?.label ?? ""}
      itemToElement={renderItem}
      renderSelectedItem={renderItem}
      {...(onTriggerKeyDown ? { onKeyDownCapture: onTriggerKeyDown } : {})}
      onChange={({ selectedItem }) => {
        if (selectedItem && selectedItem.id !== value) onSelect(selectedItem.id);
      }}
    />
  );
}
