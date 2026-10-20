interface Props {
  lines: string[];
}

export function WhatsNext({ lines }: Props) {
  if (!lines.length) return null;
  return (
    <div className="whats-next">
      <div className="label">What's next</div>
      {lines.map((line, i) => (
        <div className="line" key={i}>
          {line}
        </div>
      ))}
    </div>
  );
}
