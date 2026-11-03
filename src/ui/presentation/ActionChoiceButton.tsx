import "./actionChoiceButton.css";

interface ActionChoiceButtonProps {
  text: string;
  disabled: boolean;
  onClick: () => void;
}

/** Shared presentation only; the owning module submits its own command. */
export function ActionChoiceButton({ text, disabled, onClick }: ActionChoiceButtonProps) {
  return (
    <button className="action-choice-button" type="button" disabled={disabled} onClick={onClick}>
      {text}
    </button>
  );
}
