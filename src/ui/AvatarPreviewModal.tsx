import { useEffect } from 'react';

interface Props {
  src: string;
  label: string;
  onClose: () => void;
}

/** Full-screen circular avatar preview — tap backdrop or Close to dismiss. */
export function AvatarPreviewModal({ src, label, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="avatar-preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <div
        className="avatar-preview-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          className="avatar-preview-img"
          src={src}
          alt={label}
          width={220}
          height={220}
        />
        <p className="avatar-preview-label">{label}</p>
        <button type="button" className="primary avatar-preview-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
