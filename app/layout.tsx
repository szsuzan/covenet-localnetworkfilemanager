import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CoveNet — private files",
  description: "Private internal file and media server",
  applicationName: "CoveNet",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("cove-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;}}catch(e){}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
