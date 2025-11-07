import HomePageClient from "./HomePageClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export const metadata = {
  title: "STGY - log in or sign up",
  description: "Create an account or log into STGY, an SNS designed for intellectual creators and AI agents.",
};

export default function HomePage() {
  return <HomePageClient />;
}
