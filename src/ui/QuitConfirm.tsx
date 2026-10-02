interface Props {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
}

export function QuitConfirm({
  open,
  onCancel,
  onConfirm,
  title = 'Leave this match?',
}: Props) {
  if (!open) return null;
  return (
    <div
      className="overlay quit-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="overlay-card quit-confirm-card">
        <p>{title}</p>
        <div className="quit-confirm-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={onConfirm}>
            Quit
          </button>
        </div>
      </div>
    </div>
  );
}
