import Link from "next/link";

// App-wide footer: brand line + primary links, including the "How it works" page.
export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="footer-in">
        <span>Campaign Factory · UK local &amp; public-policy campaigns · public data only, a human approves everything</span>
        <nav className="footer-links">
          <Link href="/">New campaign</Link>
          <Link href="/gallery">Campaign Gallery</Link>
          <Link href="/how">How it works</Link>
        </nav>
      </div>
      <p className="footer-caption">
        This application was built as a prototype in 2 days for the AI &amp; Campaigning conference on 16 July 2026. Please verify before using any AI generated content.
      </p>
    </footer>
  );
}
