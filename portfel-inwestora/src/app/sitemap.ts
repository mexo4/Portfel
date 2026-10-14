import type { MetadataRoute } from "next";

/** Public marketing routes only; never index private /dashboard or /portfolio URLs. */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = "https://mexo.com.pl";
  const pages: MetadataRoute.Sitemap = [
    { url: `${origin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/pricing`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${origin}/narzedzia/procent-skladany`, changeFrequency: "monthly", priority: 0.8 },
  ];
  // Inclusion is explicit, because redistribution rights for all public event sources
  // must be reviewed before asking search engines to index the new calendar.
  if (process.env.MEXO_PUBLIC_GPW_CALENDAR_INDEXABLE === "true") {
    pages.push({ url: `${origin}/kalendarz-gpw`, changeFrequency: "daily", priority: 0.9 });
  }
  if (process.env.MEXO_PUBLIC_DIVIDENDS_INDEXABLE === "true") {
    pages.push({ url: `${origin}/kalendarz-dywidend`, changeFrequency: "daily", priority: 0.9 });
  }
  return pages;
}
