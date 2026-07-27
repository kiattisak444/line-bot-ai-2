export const metadata = {
  title: "line-bot-ai-2",
  description: "LINE Bot ร้านอาหารตามสั่ง (Gemini AI)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
