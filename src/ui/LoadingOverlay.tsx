export function LoadingOverlay({ message }: { message: string }) {
  return (
    <div className="loading-overlay">
      <div className="loading-box">
        <h1>COGNITIVE NPC</h1>
        <div className="spinner" />
        <p>{message}</p>
        <p className="fine">Soldier/Xbot/Michelle GLB (three.js example assets, MIT) · Poly Haven CC0 textures</p>
      </div>
    </div>
  );
}
