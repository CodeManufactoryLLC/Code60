import { useEffect, useId, useRef, useState } from "react";
import { Button as AppButton } from "./carbon/button.js";
import { TextInput as CarbonTextInput } from "./carbon/fields.js";
import { Modal } from "./modal.js";

export function RenameChat({
  title,
  onSave,
  onClose,
}: {
  title: string;
  onSave(title: string): Promise<boolean>;
  onClose(): void;
}) {
  const formId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    input.current?.select();
  }, []);
  return (
    <Modal
      footer={
        <>
          <AppButton variant="secondary" type="button" onClick={onClose} disabled={pending}>
            Cancel
          </AppButton>
          <AppButton
            variant="primary"
            form={formId}
            type="submit"
            disabled={pending || !value.trim()}
          >
            Save
          </AppButton>
        </>
      }
      size="sm"
      title="Rename chat"
      busy={pending}
      onClose={onClose}
    >
      <form
        id={formId}
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending || !value.trim()) return;
          setPending(true);
          setError("");
          try {
            if (await onSave(value.trim())) onClose();
            else setError("Could not rename this chat. Try again.");
          } catch {
            setError("Could not rename this chat. Try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        <div>
          <CarbonTextInput
            ref={input}
            labelText={<>Chat name</>}
            value={value}
            maxLength={120}
            required
            disabled={pending}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        {error && <p role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
