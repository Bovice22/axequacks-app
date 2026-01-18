import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Staff - Axe Quacks",
};

export default function StaffLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
