export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(180deg, #07121b 0%, #040a11 100%)",
        color: "#e8f0fb",
        fontFamily: "SFMono-Regular, Menlo, Consolas, monospace",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ opacity: 0.6, letterSpacing: "0.2em", textTransform: "uppercase", fontSize: "0.75rem" }}>
          Lost In The Settlement
        </div>
        <h1 style={{ margin: "12px 0 0", fontSize: "1.4rem" }}>This page is not here.</h1>
      </div>
    </main>
  );
}
