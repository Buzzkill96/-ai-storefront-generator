export function StoreNotFound() {
  return (
    <div className="wrap" style={{ textAlign: "center", paddingTop: 80 }}>
      <div style={{ fontSize: 44 }}>🛍️</div>
      <h1 className="h1">This store isn&apos;t available</h1>
      <p className="sub">The link may be mistyped, or the creator hasn&apos;t published it yet.</p>
      <a className="btn" href="/">Build your own store</a>
    </div>
  );
}
