/** Animated dot — used in the pending state and as a loading marker. */
export function Spinner({ label }: { label?: string }) {
  return (
    <span className="pending">
      <span className="dot" />
      {label && <span>{label}</span>}
    </span>
  );
}
