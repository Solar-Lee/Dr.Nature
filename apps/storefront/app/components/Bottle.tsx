// Illustrative bottle (示意): the opaque white 100 ml PE bottle from 2. 產品瓶器&包裝 with a numbered
// label, drawn in CSS so the preview needs no product photography. DESIGN replaces it (D-07).
export function Bottle({
  num,
  name,
  tint = 1,
  width = 150,
  float = false,
  dolly = false,
}: {
  num: string;
  name: string;
  tint?: 1 | 2 | 3;
  width?: number;
  float?: boolean;
  dolly?: boolean;
}) {
  const cls = ["bottle", float ? "float" : "", dolly ? "dolly" : ""].filter(Boolean).join(" ");
  return (
    <div className="stand" aria-hidden="true">
      <div className={cls} style={{ ["--w" as string]: `${width}px`, ["--tint" as string]: `var(--tint-${tint})` }}>
        <div className="cap" />
        <div className="neck" />
        <div className="body">
          <div className="label">
            <div className="mini">
              Dr<i>.</i>Nature
            </div>
            <b>{num}</b>
            <span>{name}</span>
          </div>
        </div>
      </div>
      <div className="bottle-shadow" />
    </div>
  );
}
